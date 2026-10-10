// 农历：直接用浏览器内置的中文日历，不引入外部农历库也不手写历法表。
// 支持度：Chrome 90+ / Edge / Safari 15.4+ / Firefox 均有 Intl 农历实现。
// 任何异常都降级为空字符串，首页不会因为它崩掉。
const LUNAR_DAYS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];

let formatter: Intl.DateTimeFormat | null | undefined;

function getFormatter(): Intl.DateTimeFormat | null {
  if (formatter !== undefined) return formatter;
  try {
    const f = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
    f.format(new Date());
    formatter = f;
  } catch {
    formatter = null;
  }
  return formatter;
}

/** 返回「农历九月初一」这样的文本；不支持时返回空字符串 */
export function lunarText(date: Date): string {
  const fmt = getFormatter();
  if (!fmt) return '';
  try {
    const parts = fmt.formatToParts(date);
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const day = Number(parts.find((p) => p.type === 'day')?.value || 0);
    if (!month || !day) return '';
    return `农历${month}${LUNAR_DAYS[day - 1] || `${day}日`}`;
  } catch {
    return '';
  }
}

/** 只取「九月初一」这一段，用于日历格子下方的小字 */
export function lunarShort(date: Date): string {
  const full = lunarText(date);
  return full ? full.replace(/^农历/, '') : '';
}
