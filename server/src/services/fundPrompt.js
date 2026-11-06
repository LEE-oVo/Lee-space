import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { SOURCE_LABELS } from './fundSource.js';

// 提示词集中托管：模板存在工作台，各执行方（WorkBuddy / 智谱 GLM / Trae）
// 通过 GET /wb-api/funds/prompt 取渲染后的全文，本地任务只留一句引导语。
//
// 为什么要这么干：之前同一份规则要在三处各存一份，改一个数字就得同步三次，
// 漏一处就会出现「两个模型按不同口径给建议」。现在只有一份。
//
// 分层：
//   文件（src/prompts/*.md）= 出厂默认，跟着代码走，可版本管理
//   settings 同名键         = 我在页面上的覆盖，优先级更高，清空即恢复默认
//   渲染                    = 把令牌/来源/模型名等变量替换进去

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

const KINDS = {
  analysis: {
    file: 'fund-analysis.md',
    key: 'fund.prompt.analysis',
    label: '今日操作建议',
    requires: ['{{TOKEN}}', '{{BASE}}', '{{SOURCE}}', '{{MODEL}}', '{{ROLE}}'],
  },
  settle: {
    file: 'fund-settle.md',
    key: 'fund.prompt.settle',
    label: '收盘结算',
    requires: ['{{TOKEN}}', '{{BASE}}', '{{ROLE}}'],
  },
};

/** 每个来源在 payload 里写什么 model 名，历史值保持不变，别改 */
const MODEL_NAMES = {
  workbuddy: 'workbuddy-automation',
  glm: 'glm-automation',
  trae: 'trae-work',
  manual: 'manual',
};

/** 每个来源的身份说明，渲染时替换 {{ROLE}} */
const ROLE_TEXT = {
  workbuddy: '',
  glm: '本任务使用**智谱 GLM** 执行。工作台现在只保留你这一路分析，页面上看到的就是你的判断，'
    + '我会自己决定采纳哪一条、也可能自己改主意。所以你只管给出自己认为最合理的一版。',
  trae: '本机 WorkBuddy 当天没跑成，由你补一次。',
  manual: '',
};

// 文件是「出厂设置」，读一次就够；改了文件要重启才生效（改了库不用）
const fileCache = new Map();
function readDefault(kind) {
  if (fileCache.has(kind)) return fileCache.get(kind);
  const text = fs.readFileSync(path.join(DIR, KINDS[kind].file), 'utf8');
  fileCache.set(kind, text);
  return text;
}

/** 取模板：库里有覆盖就用库里的，否则用文件里的出厂版本 */
export function getTemplate(kind) {
  const k = KINDS[kind];
  if (!k) return null;
  const row = getDb().prepare(`SELECT value, updated_at FROM settings WHERE key = ?`).get(k.key);
  const custom = row?.value ? String(row.value) : '';
  return {
    kind,
    label: k.label,
    text: custom || readDefault(kind),
    isCustom: Boolean(custom),
    updatedAt: row?.updated_at || null,
    requires: k.requires,
  };
}

/** 保存模板；传空字符串 = 清除覆盖、恢复出厂版本 */
export function setTemplate(kind, text, updatedBy = null) {
  const k = KINDS[kind];
  if (!k) return { ok: false, errors: [`未知的提示词类型：${kind}`] };
  const v = String(text ?? '');
  const db = getDb();

  if (!v.trim()) {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(k.key);
    return { ok: true, restored: true };
  }

  // 占位符被删掉，渲染出来就会缺令牌或来源，直接拒绝比事后排查强
  const missing = k.requires.filter((t) => !v.includes(t));
  if (missing.length) {
    return {
      ok: false,
      errors: [`模板缺少占位符：${missing.join(' / ')}（删了会导致渲染后缺令牌或来源）`],
    };
  }

  db.prepare(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(k.key, v, updatedBy, Math.floor(Date.now() / 1000));
  return { ok: true };
}

/** 给某个来源渲染出可直接执行的全文；来源没有令牌就返回 null（不能凭空发别人的令牌） */
export function renderPrompt(kind, source) {
  const k = KINDS[kind];
  if (!k) return null;
  const token = config.fundIngestTokens?.[source];
  if (!token) return null;
  // 分析提示词只发给还在出建议的来源。只留结算权限的来源取不到，
  // 免得它照着提示词跑一遍再在 /ingest 被 403（那是白白消耗一次模型调用）
  const analysisAllow = config.fundAnalysisSources || [];
  if (kind === 'analysis' && analysisAllow.length && !analysisAllow.includes(source)) return null;

  const canSettle = (config.fundSettleSources || []).includes(source);
  const vars = {
    TOKEN: token,
    BASE: config.fundPublicBase,
    SOURCE: source,
    SOURCE_LABEL: SOURCE_LABELS[source] || source,
    MODEL: MODEL_NAMES[source] || `${source}-automation`,
    ROLE: ROLE_TEXT[source] || '',
    CAN_SETTLE_NOTE: canSettle
      // 白名单里也不该顺手结算——那是另一个任务的职责，混着干容易把账本搞乱
      ? '（本来源在账本写入白名单里，但**本任务不需要结算**，不要调 /settle）'
      : '（本来源**没有**账本写入权限，只能投建议，**不要调 /settle**）',
  };

  return getTemplate(kind).text
    // 模板可能是 CRLF（Windows 编辑过），先归一，否则下面的空行折叠不生效
    .replace(/\r\n?/g, '\n')
    .replace(/\{\{([A-Z_]+)\}\}/g, (m, name) => {
      const v = vars[name];
      return v === undefined ? m : String(v);
    })
    // {{ROLE}} 为空时（WorkBuddy / manual）会留下几个空行，压掉，别把提示词撑得松垮
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

/** 页面用：一次拿两份模板 + 各自需要哪些占位符 */
export function promptOverview() {
  const analysisAllow = config.fundAnalysisSources || [];
  return {
    base: config.fundPublicBase,
    kinds: Object.keys(KINDS).map((kind) => getTemplate(kind)),
    sources: Object.keys(config.fundIngestTokens || {}).map((s) => ({
      source: s,
      label: SOURCE_LABELS[s] || s,
      canSettle: (config.fundSettleSources || []).includes(s),
      // 能不能出分析建议：现在只有唯一的那个模型
      canAnalyze: analysisAllow.length === 0 || analysisAllow.includes(s),
    })),
  };
}
