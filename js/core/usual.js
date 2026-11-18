// 「いつもの1杯」（X15）：今の時間帯に、直近60日でいちばん多く淹れた「豆＋レシピ」を選ぶ（純粋関数、D-139）
// 時間帯は 朝5〜11時・昼11〜17時・夜17〜5時。★を付けて3未満だった杯は数えない。
// その豆が飲み切り・残りなしなら、同じレシピで今ある豆（最近淹れた順）にする。

import { pickTasting } from './tastings.js';

/** 数える期間（日） */
export const USUAL_DAYS = 60;
/** これ未満の★の杯は数えない */
export const USUAL_MIN_STARS = 3;

export const BANDS = Object.freeze([
  { key: 'morning', label: '朝', from: 5, to: 11 },
  { key: 'day', label: '昼', from: 11, to: 17 },
  { key: 'night', label: '夜', from: 17, to: 29 }, // 29 = 翌朝5時
]);

/** 時刻の時間帯 */
export function bandOf(date) {
  const h = new Date(date).getHours();
  const hh = h < 5 ? h + 24 : h;
  return BANDS.find((b) => hh >= b.from && hh < b.to);
}

const alive = (r) => r && r.deletedAt == null;

/**
 * いつもの1杯
 * @param {{brews?:object[], tastings?:object[], recipes?:object[], usableBeanIds?:string[], now?:Date}} p
 *   usableBeanIds は1杯ぶん以上残っている豆の ID
 * @returns {null|{recipe:object, beanId:string|null, band:object, count:number, allDay:boolean, beanChanged:boolean, href:string}}
 */
export function usualCup({ brews = [], tastings = [], recipes = [], usableBeanIds = [], now = new Date() }) {
  const since = new Date(now).getTime() - USUAL_DAYS * 86400000;
  const recipeOf = new Map(recipes.filter(alive).map((r) => [r.id, r]));
  const usable = new Set(usableBeanIds);
  const list = brews.filter((b) => {
    if (!alive(b) || !recipeOf.has(b.recipeId)) return false;
    const t = new Date(b.at).getTime();
    if (!(t >= since && t <= new Date(now).getTime())) return false;
    const stars = pickTasting(tastings, b.id)?.stars;
    return !(Number.isFinite(stars) && stars < USUAL_MIN_STARS);
  });
  if (!list.length) return null;
  const band = bandOf(now);
  const inBand = list.filter((b) => bandOf(b.at).key === band.key);
  const pool = inBand.length ? inBand : list;

  // 豆＋レシピの組み合わせごとに数える（同じ数なら最後に淹れたのが新しいほう）
  const combos = new Map();
  for (const b of pool) {
    const key = `${b.recipeId}|${b.beanId ?? ''}`;
    const c = combos.get(key) ?? { recipeId: b.recipeId, beanId: b.beanId ?? null, count: 0, last: '' };
    c.count += 1;
    if (String(b.at) > c.last) c.last = String(b.at);
    combos.set(key, c);
  }
  const best = [...combos.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))[0];

  let beanId = best.beanId;
  let beanChanged = false;
  if (!beanId || !usable.has(beanId)) {
    // 今ある豆のうち、最近淹れた豆（淹れていなければ並びの先頭）
    const lastAt = new Map();
    for (const b of brews) if (alive(b) && usable.has(b.beanId) && String(b.at) > (lastAt.get(b.beanId) ?? '')) lastAt.set(b.beanId, String(b.at));
    const next = [...usableBeanIds].sort((a, b) => (lastAt.get(b) ?? '').localeCompare(lastAt.get(a) ?? ''))[0] ?? null;
    beanChanged = Boolean(best.beanId) && next !== best.beanId;
    beanId = next;
  }
  const q = new URLSearchParams({ recipe: best.recipeId });
  if (beanId) q.set('bean', beanId);
  return { recipe: recipeOf.get(best.recipeId), beanId, band, count: best.count, allDay: !inBand.length, beanChanged, href: `brew.html?${q.toString()}` };
}

/** 説明の一言「朝によく淹れる組み合わせ（直近60日で5回）」 */
export function usualReason(u) {
  if (!u) return '';
  const when = u.allDay ? 'よく淹れる組み合わせ' : `${u.band.label}によく淹れる組み合わせ`;
  return `${when}（直近${USUAL_DAYS}日で${u.count}回）${u.beanChanged ? '。いつもの豆がないので、今ある豆にしました' : ''}`;
}
