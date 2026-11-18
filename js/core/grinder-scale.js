// グラインダー目盛り表（D2）：目盛りと粒度の目安（µm）を対応させ、別のグラインダーの目盛りに換算する（純粋関数）
// 粒度は「挽いた粉のだいたいの大きさ」。メーカーの表や、ふるい・粒度の見本と比べて入れる目安の値。
// 目盛りは数字だけを扱う（D-053：数字が小さいほど細かい）。表の間は直線で結び、表の外側は端の2行の傾きで延ばす。

/** 粒度の言葉と目安（µm）。表の入力で選ぶと値が入る */
export const GRIND_SIZES = Object.freeze([
  { key: 'extraFine', label: '極細挽き', um: 250 },
  { key: 'fine', label: '細挽き', um: 450 },
  { key: 'mediumFine', label: '中細挽き', um: 650 },
  { key: 'medium', label: '中挽き', um: 850 },
  { key: 'coarse', label: '粗挽き', um: 1100 },
]);

export const UM_MIN = 100;
export const UM_MAX = 2000;
/** 表の行の上限 */
export const SCALE_MAX_ROWS = 12;

const toNum = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').normalize('NFKC').trim();
  return s === '' ? null : Number(s);
};
const round = (n, step) => Math.round(n / step) * step;
const fix = (n) => Number(n.toFixed(4));

/** いちばん近い粒度の言葉「中細挽き」 */
export function sizeWord(um) {
  if (!(um > 0)) return '';
  let best = GRIND_SIZES[0];
  for (const s of GRIND_SIZES) if (Math.abs(s.um - um) < Math.abs(best.um - um)) best = s;
  return best.label;
}

/**
 * 目盛り表の入力を確かめる。空の行は捨て、目盛りの小さい順に並べる。
 * @param {{setting:string|number, um:string|number}[]} rows
 * @returns {{value:{setting:number, um:number}[], error:string|null}}
 */
export function normalizeScaleRows(rows) {
  const out = [];
  for (const r of rows ?? []) {
    const setting = toNum(r?.setting);
    const um = toNum(r?.um);
    if (setting == null && um == null) continue;
    if (setting == null || !Number.isFinite(setting)) return { value: [], error: '目盛り表の目盛りは数字で入れてください' };
    if (um == null || !Number.isFinite(um) || um < UM_MIN || um > UM_MAX) {
      return { value: [], error: `目盛り表の粒度は${UM_MIN}〜${UM_MAX}の数字（µm）で入れてください` };
    }
    out.push({ setting, um: Math.round(um) });
  }
  if (out.length > SCALE_MAX_ROWS) return { value: [], error: `目盛り表は${SCALE_MAX_ROWS}行までです` };
  out.sort((a, b) => a.setting - b.setting);
  for (let i = 1; i < out.length; i++) {
    if (out[i].setting === out[i - 1].setting) return { value: [], error: `目盛り ${out[i].setting} が2回入っています` };
  }
  return { value: out, error: null };
}

/** 2行を結んだ直線で x の値を求める */
const lerp = (x, x0, y0, x1, y1) => (x1 === x0 ? y0 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0));

/**
 * 目盛りから粒度（µm）を出す。
 * @param {{setting:number, um:number}[]} scale normalizeScaleRows の結果（目盛りの小さい順）
 * @returns {{um:number, outside:boolean}|null} outside は表の外側を延ばして出した値
 */
export function umAt(scale, setting) {
  const s = toNum(setting);
  if (!Array.isArray(scale) || !scale.length || s == null || !Number.isFinite(s)) return null;
  const exact = scale.find((r) => r.setting === s);
  if (exact) return { um: exact.um, outside: false };
  if (scale.length < 2) return null;
  const n = scale.length;
  let i = scale.findIndex((r) => r.setting > s);
  const outside = i <= 0;
  if (i === -1) i = n - 1;
  if (i === 0) i = 1;
  const um = Math.round(lerp(s, scale[i - 1].setting, scale[i - 1].um, scale[i].setting, scale[i].um));
  return um > 0 ? { um, outside } : null;
}

/**
 * 粒度（µm）に近い目盛りを出す（目盛りの刻みに丸める）。
 * 粒度は目盛りが大きいほど大きい前提（表がそうでなければ null）。
 * @returns {{setting:number, outside:boolean}|null}
 */
export function settingFor(scale, um, step = 1) {
  if (!Array.isArray(scale) || scale.length < 2 || !(um > 0)) return null;
  for (let i = 1; i < scale.length; i++) if (scale[i].um <= scale[i - 1].um) return null;
  const n = scale.length;
  let i = scale.findIndex((r) => r.um > um);
  const outside = i === 0 || (i === -1 && um > scale[n - 1].um);
  if (i === -1) i = n - 1;
  if (i === 0) i = 1;
  const raw = lerp(um, scale[i - 1].um, scale[i - 1].setting, scale[i].um, scale[i].setting);
  const st = step > 0 ? step : 1;
  return { setting: fix(round(raw, st)), outside };
}

/** グラインダー（器具の記録）の目盛り表。なければ [] */
export function scaleOf(grinder) {
  const rows = grinder?.attrs?.scale;
  return Array.isArray(rows) ? rows : [];
}

/**
 * あるグラインダーの目盛りを、別のグラインダーの目盛りに換算する。
 * @returns {{um:number, setting:number, word:string, outside:boolean}|null}
 */
export function convertSetting(fromGrinder, setting, toGrinder) {
  const from = umAt(scaleOf(fromGrinder), setting);
  if (!from) return null;
  const to = settingFor(scaleOf(toGrinder), from.um, toGrinder?.attrs?.step ?? 1);
  if (!to) return null;
  return { um: from.um, setting: to.setting, word: sizeWord(from.um), outside: from.outside || to.outside };
}

/** 「24 → 約650µm（中細挽き）」のような短い文。表がなければ空文字 */
export function grindSizeText(grinder, setting) {
  const r = umAt(scaleOf(grinder), setting);
  if (!r) return '';
  return `約${r.um}µm（${sizeWord(r.um)}${r.outside ? '・表の外側' : ''}）`;
}
