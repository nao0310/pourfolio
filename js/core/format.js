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
