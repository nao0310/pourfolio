// 表示用の整形（純粋関数）

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 日時を「2026/11/18 09:05」の形にする（端末のタイムゾーン）。
 * @param {Date|string|number} value
 * @returns {string} 不正な値なら空文字
 */
export function formatDateTimeJa(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 端末のタイムゾーンでの日付「2026-11-18」（入力欄 type=date の値と同じ形）
 * @param {Date|string|number} [value]
 */
export function localYmd(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 「2026-11-18」を「11/18」や「2026/11/18」の形にする
 * @param {string} ymd
 * @param {{withYear?: boolean}} [opts]
 */
export function formatYmdJa(ymd, { withYear = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '');
  if (!m) return '';
  const md = `${Number(m[2])}/${Number(m[3])}`;
  return withYear ? `${m[1]}/${md}` : md;
}

/**
 * 日時を、端末のタイムゾーンの日付で「1/5」（withYear なら「2026/1/5」）にする（2-8の43番）。
 * 世界標準時の日付（toISOString の先頭）を使うと、日本時間の0〜9時に前の日になるため
 * @param {Date|string|number} value
 */
export function formatDateJa(value, opts = {}) {
  return formatYmdJa(localYmd(value), opts);
}

/** 重さを「164.2g」の形にする（小数点以下が0なら省く） */
export function formatG(g) {
  if (g == null || Number.isNaN(g)) return '';
  const r = Math.round(g * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}g`;
}
