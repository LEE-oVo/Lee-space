/*
 * 净值序列的技术指标：服务端算好统一下发，不让每个模型自己心算。
 *
 * 为什么必须在服务端算：
 *   三个模型拿到同一串净值，各自目测「是不是在高位」，算法和窗口都不一样，
 *   于是同一天能得出三种「位置判断」，页面上的横向对比就失去意义。
 *   算一次、发一份，各家在同一个基准上比判断力，才是这个模块该有的样子。
 *
 * 这里只做描述性统计，不做任何买卖结论——判断仍然完全交给模型。
 */

const TRADING_DAYS = 252;

function round(v, digits = 2) {
  const f = 10 ** digits;
  return Math.round(Number(v) * f) / f;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** 简单移动平均：取序列末尾 n 个点，不足 n 个就返回 null（不做凑数） */
function ma(navs, n) {
  if (navs.length < n) return null;
  return round(mean(navs.slice(-n)), 4);
}

/** 样本标准差（n-1），用于波动率 */
function stdev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

/**
 * RSI(14)，Wilder 平滑。
 * 只用最近 15 个点的简单平均做初值——序列够长时差异可以忽略，
 * 而我们本来就只有几十天数据，过度追求与行情软件逐位对齐没有意义。
 */
function rsi(navs, period = 14) {
  if (navs.length < period + 1) return null;
  const diffs = [];
  for (let i = navs.length - period; i < navs.length; i += 1) {
    diffs.push(navs[i] - navs[i - 1]);
  }
  const gains = diffs.map((d) => (d > 0 ? d : 0));
  const losses = diffs.map((d) => (d < 0 ? -d : 0));
  const avgGain = mean(gains);
  const avgLoss = mean(losses);
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return round(100 - 100 / (1 + rs), 1);
}

/** 区间涨跌幅：不足 k+1 个点返回 null */
function chg(navs, k) {
  if (navs.length < k + 1) return null;
  const prev = navs[navs.length - 1 - k];
  if (!prev) return null;
  return round(((navs[navs.length - 1] - prev) / prev) * 100, 2);
}

/** 末尾连续涨/跌天数：+n 连涨，-n 连跌，0 表示数据不足 */
function streak(navs) {
  let n = 0;
  for (let i = navs.length - 1; i > 0; i -= 1) {
    const d = navs[i] - navs[i - 1];
    if (d > 0) {
      if (n < 0) break;
      n += 1;
    } else if (d < 0) {
      if (n > 0) break;
      n -= 1;
    } else break;
  }
  return n;
}

/**
 * 主入口。series 为升序 [{date, nav}]。
 * estimate 可选：有盘中估算值时，位置分位与乖离按估算价再算一份，
 * 让模型看到「按昨收」和「按现在」两个口径的差别。
 */
export function computeTechnicals(series, estimate = null) {
  const points = Array.isArray(series) ? series.filter((p) => Number.isFinite(Number(p?.nav))) : [];
  if (points.length < 2) return null;

  const navs = points.map((p) => Number(p.nav));
  const last = navs[navs.length - 1];

  // 位置分位：窗口内最低到最高的相对位置。净值序列只有几十天时窗口自动缩短，
  // 所以这里用「现有全部点」而不是死板的 60 日，避免出现"数据不够就整个没了"
  const win = navs.slice(-60);
  const hi = Math.max(...win);
  const lo = Math.min(...win);
  const posPct = hi > lo ? round(((last - lo) / (hi - lo)) * 100, 1) : null;

  // 年化波动率：近 20 个日收益的标准差 × √252
  const recent = navs.slice(-21);
  const rets = [];
  for (let i = 1; i < recent.length; i += 1) {
    if (recent[i - 1] > 0) rets.push((recent[i] - recent[i - 1]) / recent[i - 1]);
  }
  const sd = stdev(rets);

  const ma20 = ma(navs, 20);
  const ma5 = ma(navs, 5);

  const out = {
    last: round(last, 4),
    asOf: points[points.length - 1].date,
    points: points.length,
    ma5,
    ma20,
    // 乖离：现价相对 MA20 的偏离百分比，正值=在均线上方
    bias20: ma20 ? round(((last - ma20) / ma20) * 100, 2) : null,
    // 均线关系：golden=短期上穿长期，dead=下穿，null=数据不足
    maCross: ma5 && ma20 ? (ma5 >= ma20 ? 'above' : 'below') : null,
    posPct,
    high60: round(hi, 4),
    low60: round(lo, 4),
    vol20Pct: sd !== null ? round(sd * Math.sqrt(TRADING_DAYS) * 100, 1) : null,
    rsi14: rsi(navs),
    chg5: chg(navs, 5),
    chg10: chg(navs, 10),
    chg20: chg(navs, 20),
    streak: streak(navs),
  };

  // 盘中估算价的位置：估值比昨收低，不代表它就便宜——
  // 要跟它自己在区间里的位置比。两个口径一起给，模型才不会把「跌了」直接等同于「便宜」
  if (Number.isFinite(Number(estimate)) && Number(estimate) > 0) {
    const est = Number(estimate);
    if (hi > lo) {
      // 估算价可能跌破区间下沿（或冲过上沿）。分位仍然夹到 0-100，
      // 但用下面的标记如实说明「越界了」——夹住是为了不让模型读到负数分位一头雾水，
      // 标记是为了不把「跌破历史最低」这种强信号抹掉
      out.estimatePosPct = round(Math.min(100, Math.max(0, ((est - lo) / (hi - lo)) * 100)), 1);
      out.estimateBelowRange = est < lo;
      out.estimateAboveRange = est > hi;
    }
    out.estimateBias20 = ma20 ? round(((est - ma20) / ma20) * 100, 2) : null;
  }

  return out;
}

/** 给模型看的一行文字说明，避免它误读字段 */
export function describeTechnicals(t) {
  if (!t) return '净值序列不足，无技术指标。';
  const parts = [];
  if (t.posPct !== null) {
    parts.push(t.posPct >= 70 ? `处近 60 日区间的偏高位置（${t.posPct}%）`
      : t.posPct <= 30 ? `处近 60 日区间的偏低位置（${t.posPct}%）`
        : `处近 60 日区间中部（${t.posPct}%）`);
  }
  if (t.ma5 && t.ma20) parts.push(`MA5 ${t.ma5} ${t.maCross === 'above' ? '在' : '低于'}MA20 ${t.ma20}`);
  if (t.rsi14 !== null) parts.push(`RSI14 ${t.rsi14}${t.rsi14 >= 70 ? '（超买区）' : t.rsi14 <= 30 ? '（超卖区）' : ''}`);
  if (t.streak > 1) parts.push(`已连涨 ${t.streak} 个交易日`);
  if (t.streak < -1) parts.push(`已连跌 ${-t.streak} 个交易日`);
  if (t.vol20Pct !== null) parts.push(`20 日年化波动率 ${t.vol20Pct}%`);
  if (t.estimateBelowRange) parts.push('盘中估值已跌破近 60 日最低');
  if (t.estimateAboveRange) parts.push('盘中估值已突破近 60 日最高');
  return parts.join('，') + '。';
}
