// 水プロファイル（D3）：成分を確かめ、SCAAの水の基準（2009年、spec 2.1）との差を出す（純粋関数）
// 水は器具の種類「水」として登録する（D-115）。成分は器具の attrs に入れる。

/**
 * 基準。lo〜hi が「基準の範囲」、target が目標。前後（±tol）だけ決まっている項目は lo/hi を target±tol にした。
 * 硬度はカルシウム硬度（CaCO3換算）の基準。日本の水のラベルの「硬度」は総硬度なので、比べるのは目安。
 */
export const WATER_ITEMS = Object.freeze([
  { key: 'tdsMgL', label: 'TDS', unit: 'mg/L', target: 150, lo: 75, hi: 250, max: 2000 },
  { key: 'hardnessMgL', label: '硬度', unit: 'mg/L', target: 68, lo: 17, hi: 85, max: 2000 },
  { key: 'alkalinityMgL', label: 'アルカリ度', unit: 'mg/L', target: 40, lo: 30, hi: 50, max: 1000 },
  { key: 'ph', label: 'pH', unit: '', target: 7.0, lo: 6.5, hi: 7.5, max: 14 },
  { key: 'sodiumMgL', label: 'ナトリウム', unit: 'mg/L', target: 10, lo: 5, hi: 15, max: 1000 },
]);

export const WATER_KEYS = Object.freeze(WATER_ITEMS.map((i) => i.key));

const toNum = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').normalize('NFKC').trim();
  return s === '' ? null : Number(s);
};

/**
 * 水の成分の入力を確かめる。空の項目は null。
 * @param {Record<string,string|number>} raw
 * @returns {{value:Record<string, number|null>, errors:Record<string,string>}}
 */
export function normalizeWaterInput(raw) {
  const value = {};
  const errors = {};
  for (const it of WATER_ITEMS) {
    const n = toNum(raw?.[it.key]);
    if (n == null) value[it.key] = null;
    else if (!Number.isFinite(n) || n < 0 || n > it.max) {
      errors[it.key] = `${it.label}は0〜${it.max}の数字${it.unit ? `（${it.unit}）` : ''}で入れてください`;
      value[it.key] = null;
    } else value[it.key] = Math.round(n * 10) / 10;
  }
  return { value, errors };
}

const fmt = (n) => String(Math.round(n * 10) / 10);

/**
 * 基準との比べ。入れていない項目は status 'none'。
 * @param {Record<string, number|null>} attrs
 * @returns {{key:string, label:string, value:number|null, unit:string, status:'ok'|'low'|'high'|'none', text:string, rangeText:string}[]}
 */
export function waterCheck(attrs = {}) {
  return WATER_ITEMS.map((it) => {
    const v = attrs?.[it.key];
    const rangeText = `基準 ${fmt(it.lo)}〜${fmt(it.hi)}${it.unit ? ` ${it.unit}` : ''}（目標 ${fmt(it.target)}）`;
    if (v == null) return { key: it.key, label: it.label, value: null, unit: it.unit, status: 'none', text: '未入力', rangeText };
    const diff = Math.round((v - it.target) * 10) / 10;
    const status = v < it.lo ? 'low' : v > it.hi ? 'high' : 'ok';
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
    const vs = `目標との差 ${sign}${fmt(Math.abs(diff))}`;
    const text = status === 'ok' ? `基準の範囲（${vs}）` : `${status === 'low' ? '基準より少ない' : '基準より多い'}（${vs}）`;
    return { key: it.key, label: it.label, value: v, unit: it.unit, status, text, rangeText };
  });
}

/** 水の一覧に出す1行「TDS 80・硬度 50・pH 7.2（基準の外 2項目）」 */
export function waterSummary(attrs = {}) {
  const items = waterCheck(attrs).filter((c) => c.status !== 'none');
  if (!items.length) return '成分は未入力';
  const vals = items.map((c) => `${c.label} ${fmt(c.value)}`).join('・');
  const out = items.filter((c) => c.status !== 'ok').length;
  return `${vals}（${out ? `基準の外 ${out}項目` : 'すべて基準の範囲'}）`;
}
