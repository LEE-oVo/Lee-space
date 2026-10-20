import { getDb } from '../db/index.js';

// 直接读持仓表，不走 services/funds.js —— 那边要用这里的 readQuotes，
// 再 import 回来就成了循环依赖。这里只需要一行查询，重复一次比引入环划算。

/*
 * 盘中估值：服务端统一拉取，模型和页面都只读结果。
 *
 * 为什么不让模型自己拉行情：
 *   1. 行情接口的可用性高度依赖出口网络——本机常被挡，服务器通。同一个源换台机器结果就不一样，
 *      于是三个模型常常拿到三个不同的估值，甚至一个都拿不到。
 *   2. 模型在现场临时换源，质量不可控也不稳定，今天有明天没有。
 *   3. 大盘只有一个真相，估值应该三家共用同一个数，否则页面上的横向比较就失去意义。
 *
 * 折算口径：estimate = 最近一期净值 × (1 + 代理标的实时涨跌% × beta / 100)
 *   beta 是「基金净值日涨跌」对「代理标的日涨跌」的回归系数，取近 30 个交易日实算。
 *   全部小于 1（联接基金要留现金应对赎回，不可能满仓），不乘会系统性高估。
 *   注意 beta 是绑在「标的」上的，指数和 ETF 的 beta 不一样，换标的要重新回归。
 */

const FETCH_TIMEOUT_MS = 8000;
// 超过这个时间没刷新的就不给模型用——隔夜数据冒充盘中比没有更糟
const FRESH_WINDOW_MS = 15 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

/**
 * 代理标的，按优先级排列。每个只要给「市场前缀 + 代码」和 beta，
 * 下面三个行情域名会自动挨个兜底，不用在这里重复配。
 *
 * symbol 前缀：沪市 sh（51xxxx / 56xxxx / 58xxxx 的 ETF，以及上交所发布的中证指数），深市 sz。
 * 新增基金时在这里加一行即可；已经写进库里的自定义配置优先。
 */
const PRESET_SOURCES = {
  '016708': [
    { symbol: 'sh000811', beta: 0.950, label: '细分有色指数' },
    { symbol: 'sh516650', beta: 0.949, label: '有色金属ETF华夏' },
  ],
  '020406': [
    { symbol: 'sh561360', beta: 0.882, label: '石油ETF国泰' },
    { symbol: 'sh561570', beta: 0.936, label: '油气ETF华泰柏瑞' },
  ],
  '025857': [
    { symbol: 'sz159326', beta: 0.905, label: '电网设备ETF华夏' },
  ],
  '020274': [
    { symbol: 'sh000813', beta: 0.970, label: '细分化工指数' },
    { symbol: 'sz159082', beta: 0.933, label: '化工ETF华夏' },
  ],
};

/**
 * 行情域名，按尝试顺序。实测三个都通：
 * 腾讯两个域名互为备份；新浪覆盖面不一样——它有全部 ETF，但没有中证指数。
 */
const HOSTS = [
  {
    id: 'tencent',
    label: '腾讯',
    url: (symbols) => `https://qt.gtimg.cn/q=${symbols.map((s) => `s_${s}`).join(',')}`,
    parse: parseTencent,
  },
  {
    id: 'sina',
    label: '新浪',
    url: (symbols) => `https://hq.sinajs.cn/list=${symbols.join(',')}`,
    referer: 'https://finance.sina.com.cn/',
    parse: parseSina,
  },
  {
    id: 'tencent-alt',
    label: '腾讯备用域',
    url: (symbols) => `https://sqt.gtimg.cn/q=${symbols.map((s) => `s_${s}`).join(',')}`,
    parse: parseTencent,
  },
];

/* ---------------- 网络与解析 ---------------- */

let gbk = null;
function decodeBody(buf) {
  if (!gbk) {
    try {
      gbk = new TextDecoder('gbk');
    } catch {
      throw new Error('当前 Node 构建不支持 GBK 解码，无法解析行情源');
    }
  }
  return gbk.decode(buf);
}

async function fetchText(url, referer) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: referer ? { referer, 'user-agent': UA } : { 'user-agent': UA },
  });
  if (!res.ok) throw new Error(`上游返回 ${res.status}`);
  return decodeBody(Buffer.from(await res.arrayBuffer()));
}

/**
 * 腾讯：v_s_sh000811="市场~名称~代码~现价~涨跌额~涨跌幅~..."
 * 必须带 s_ 前缀——不带前缀返回的是另一套长布局，字段位置完全不同。
 */
function parseTencent(text) {
  const out = new Map();
  for (const line of text.split(';')) {
    const m = line.match(/v_s_([A-Za-z0-9]+)="([^"]*)"/);
    if (!m) continue;
    const parts = m[2].split('~');
    const price = Number(parts[3]);
    const pct = Number(parts[5]);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.set(m[1].toLowerCase(), { name: parts[1] || '', price, pct: Number.isFinite(pct) ? pct : null });
  }
  return out;
}

/**
 * 新浪：var hq_str_sh516650="名称,今开,昨收,现价,最高,最低,..."
 * 中证指数在新浪没有数据（返回全 0），现价为 0 会被这里判掉，自动落到下一个域名。
 */
function parseSina(text) {
  const out = new Map();
  for (const line of text.split(';')) {
    const m = line.match(/hq_str_([A-Za-z0-9]+)="([^"]*)"/);
    if (!m) continue;
    const parts = m[2].split(',');
    const price = Number(parts[3]);
    const prev = Number(parts[2]);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(prev) || prev <= 0) continue;
    out.set(m[1].toLowerCase(), { name: parts[0] || '', price, pct: ((price - prev) / prev) * 100 });
  }
  return out;
}

/* ---------------- 配置与时间 ---------------- */

function round4(v) {
  return Math.round(Number(v) * 10000) / 10000;
}

function sourcesFor(code, stored) {
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      // 库里存坏了就退回预设，别让一个坏配置把整只基金的估值拖死
    }
  }
  return PRESET_SOURCES[code] || [];
}

function shanghaiNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const pick = (type) => parts.find((p) => p.type === type)?.value || '';
  return { weekday: pick('weekday'), hhmm: `${pick('hour')}:${pick('minute')}` };
}

/** 只在盘中写估值：休市时的「当前价」是上一交易日收盘，拿去折算等于把昨天的涨跌再算一遍 */
export function isTrading(d = new Date()) {
  const { weekday, hhmm } = shanghaiNow(d);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return (hhmm >= '09:30' && hhmm <= '11:30') || (hhmm >= '13:00' && hhmm <= '15:05');
}

/** 在用的持仓：code / name / quote_sources，够取行情就行 */
function activeHoldings() {
  return getDb()
    .prepare(
      `SELECT code, name, quote_sources AS quoteSources
         FROM fund_holdings WHERE status = 'active' ORDER BY sort_order, id`
    )
    .all();
}

function latestNav(db, code) {
  return db
    .prepare(`SELECT nav, nav_date FROM fund_nav WHERE code = ? ORDER BY nav_date DESC LIMIT 1`)
    .get(code);
}

/* ---------------- 拉取 ---------------- */

/**
 * 官方估值：天天基金的 GSZ 字段。有值时精度远好于任何折算，
 * 但目前长期为 null（面向网页的估值接口已下线），所以是「有则更好」的加分项。
 */
async function fetchOfficial(codes) {
  const out = new Map();
  if (!codes.length) return out;
  try {
    const url = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo'
      + `?pageIndex=1&pageSize=20&plat=Android&appType=ttjj&product=EFund&Version=1`
      + `&deviceid=wb&Fcodes=${codes.join(',')}`;
    const json = JSON.parse(await fetchText(url, 'https://fundmobapi.eastmoney.com/'));
    for (const row of json.Datas || []) {
      const gsz = Number(row.GSZ);
      if (!Number.isFinite(gsz) || gsz <= 0) continue;
      const pct = Number(row.GSZZL);
      out.set(row.FCODE, { estimate: gsz, estimatePct: Number.isFinite(pct) ? pct : null });
    }
  } catch {
    // 官方源不可用不影响大局，往下走代理折算
  }
  return out;
}

/** 依次尝试「标的 × 域名」，拿到第一个有效报价就返回 */
async function resolveProxy(sources) {
  for (const source of sources) {
    const symbol = source.symbol.toLowerCase();
    for (const host of HOSTS) {
      try {
        const hit = host.parse(await fetchText(host.url([symbol]), host.referer)).get(symbol);
        if (hit && Number.isFinite(hit.pct)) return { hit, host, source };
      } catch {
        // 换下一个域名
      }
    }
  }
  return null;
}

const UPSERT = `
  INSERT INTO fund_quote (code, nav, nav_date, estimate, estimate_pct, method, proxy,
                          proxy_price, proxy_pct, beta, trading, as_of, updated_at)
  VALUES (@code, @nav, @navDate, @estimate, @estimatePct, @method, @proxy,
          @proxyPrice, @proxyPct, @beta, 1, @asOf, @asOf)
  ON CONFLICT(code) DO UPDATE SET
    nav = @nav, nav_date = @navDate, estimate = @estimate, estimate_pct = @estimatePct,
    method = @method, proxy = @proxy, proxy_price = @proxyPrice, proxy_pct = @proxyPct,
    beta = @beta, trading = 1, as_of = @asOf, updated_at = @asOf`;

/**
 * 拉一轮估值并落库。
 * 非盘中时段不写库（那时的报价是上一交易日收盘，折算出来是重复计数），
 * 只返回库里已有的快照，让调用方能区分「现在没有盘中估值」和「拉不到」。
 */
export async function refreshQuotes(opts = {}) {
  const db = getDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const trading = Boolean(opts.force) || isTrading();
  const holdings = activeHoldings();

  if (!trading) {
    return { ok: true, trading: false, written: 0, reason: 'non-trading', asOf: nowSec, items: readQuotes() };
  }

  const base = [];
  for (const h of holdings) {
    const sources = sourcesFor(h.code, h.quoteSources);
    const navRow = latestNav(db, h.code);
    if (!navRow?.nav || !sources.length) continue;
    base.push({ code: h.code, nav: navRow.nav, navDate: navRow.nav_date, sources });
  }
  if (!base.length) {
    return { ok: true, trading: true, written: 0, reason: 'no-holdings', asOf: nowSec, items: readQuotes() };
  }

  const official = await fetchOfficial(base.map((b) => b.code));
  const upsert = db.prepare(UPSERT);

  // 逐只串行解析：正常情况下每只 1 个请求就命中，只有源挂了才会往下多试几次
  for (const b of base) {
    const off = official.get(b.code);
    if (off) {
      upsert.run({
        code: b.code, nav: b.nav, navDate: b.navDate,
        estimate: off.estimate, estimatePct: off.estimatePct,
        method: 'official', proxy: '天天基金官方估值',
        proxyPrice: null, proxyPct: off.estimatePct, beta: 1, asOf: nowSec,
      });
      continue;
    }
    const got = await resolveProxy(b.sources);
    if (!got) continue;
    const estimatePct = round4(got.hit.pct * got.source.beta);
    upsert.run({
      code: b.code, nav: b.nav, navDate: b.navDate,
      estimate: round4(b.nav * (1 + estimatePct / 100)),
      estimatePct,
      method: 'proxy',
      proxy: `${got.host.label}·${got.source.label || got.hit.name || got.source.symbol}`,
      proxyPrice: got.hit.price, proxyPct: round4(got.hit.pct), beta: got.source.beta,
      asOf: nowSec,
    });
  }

  const fresh = readQuotes();
  return {
    ok: true,
    trading: true,
    written: base.filter((b) => fresh[b.code] && Number(fresh[b.code].asOf) === nowSec).length,
    unresolved: base.filter((b) => !fresh[b.code] || Number(fresh[b.code].asOf) !== nowSec).map((b) => b.code),
    asOf: nowSec,
    items: fresh,
  };
}

/** 给页面和 /holdings 用：带上新鲜度判断 */
export function readQuotes() {
  const db = getDb();
  const nowMs = Date.now();
  const out = {};
  for (const r of db.prepare(`SELECT * FROM fund_quote`).all()) {
    const asOfMs = Number(r.as_of || 0) * 1000;
    out[r.code] = {
      estimate: r.estimate,
      estimatePct: r.estimate_pct,
      nav: r.nav,
      navDate: r.nav_date,
      method: r.method,
      proxy: r.proxy,
      proxyPrice: r.proxy_price,
      proxyPct: r.proxy_pct,
      beta: r.beta,
      trading: Boolean(r.trading),
      asOf: Number(r.as_of || 0),
      // 超过刷新窗口就不算「实时」，模型应退回用 nav 判断并把 stale 标 true
      fresh: asOfMs > 0 && nowMs - asOfMs <= FRESH_WINDOW_MS,
    };
  }
  return out;
}

/**
 * 给定时任务下发的精简版。
 *
 * nav / navDate 必须带上：它们是折算基准，fresh 为 false 时模型要退回用它们判断，
 * 并且写回 payload 时也要填这两个字段。之前漏了，模型只能去 positions 里找同名的数——
 * 碰巧相同才没出事，这种"靠运气对齐"不该存在。
 */
export function quoteForAutomation(code, quotes = readQuotes()) {
  const q = quotes[code];
  if (!q) return null;
  return {
    // 折算基准：最近一期真实净值。fresh=false 时用它判断，也用它填 payload 的 nav/navDate
    nav: q.nav,
    navDate: q.navDate,
    estimate: q.estimate,
    estimatePct: q.estimatePct,
    proxy: q.proxy,
    proxyPct: q.proxyPct,
    method: q.method,
    beta: q.beta,
    asOf: q.asOf,
    fresh: q.fresh,
    note: q.fresh
      ? `服务端统一抓取的盘中估值（${q.proxy || q.method}），可直接采用`
      : '服务端当前没有新鲜盘中估值，请用上面 nav / navDate 的净值做判断并把 stale 标 true',
  };
}
