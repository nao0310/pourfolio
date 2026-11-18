// 次に買う豆（F6、spec 6.5、純粋関数）
// 候補＝気になる豆（まだ買っていないもの）＋これまでに買った豆（銘柄でまとめる）。
// 点数＝自分向け度（予想の★）＋開拓ボーナス（あまり飲んでいない産地・精製に足す、多腕バンディットの考え方）。
// 焙煎度は「産地の焙煎度比較 → 産地×焙煎度の★ → 店の標準／この豆でいちばん★の高い焙煎度」の順に選ぶ。

import { analysisRows, ratedRows } from './analysis.js';
import { preferenceBy, heatmap, bayesScore } from './preference.js';
import { roastPreferences, preferenceForBean, nameKey } from './compare.js';
import { mean } from './chart-scale.js';
import { pickTasting } from './tastings.js';
import { lossPct } from './roast.js';
import { splitWishlist } from './wishlist.js';
import { formatYmdJa } from './format.js';

/** 予想の★の事前の重み（今日の一杯と同じ、D-130） */
export const OWN_PRIOR_WEIGHT = 3;
/** 評価がまったくないときの★ */
export const NEUTRAL_STARS = 3;
/** 開拓ボーナス：飲んだことがない産地・精製に足す点。少ししか飲んでいない（FEW_CUPS杯未満）ときはその半分 */
export const EXPLORE_BONUS = Object.freeze({ origin: 0.5, process: 0.3 });
export const FEW_CUPS = 5;
/** 「開拓」の印を付けるボーナスの下限 */
export const EXPLORE_BADGE_MIN = 0.25;
/** 産地×焙煎度の★から焙煎度を選ぶのに要る杯数 */
export const ROAST_CELL_MIN = 3;
/** 候補の数 */
export const NEXT_BEAN_MAX = 12;
/** 注文メモの量：何日分を買うか */
export const ORDER_DAYS = 28;
/** 冷凍しないで飲み切る日数（これを超える分は冷凍庫に入れる） */
export const ROOM_DAYS = 14;
/** 生豆時の重さの刻み */
export const GREEN_STEP_G = 100;

const alive = (r) => r && r.deletedAt == null;
const clean = (v) => String(v ?? '').normalize('NFKC').trim();
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

/** 産地・精製ごとに、飲んだ杯の数（評価のない杯も数える） */
function cupCounts(brews, beans) {
  const beanOf = new Map(beans.filter(alive).map((b) => [b.id, b]));
  const origin = new Map();
  const process = new Map();
  for (const br of brews.filter(alive)) {
    const b = beanOf.get(br.beanId);
    if (!b) continue;
    const c = clean(b.origin?.country);
    const p = clean(b.process);
    if (c) origin.set(c, (origin.get(c) ?? 0) + 1);
    if (p) process.set(p, (process.get(p) ?? 0) + 1);
  }
  return { origin, process };
}

/**
 * 開拓ボーナス
 * @returns {{pts:number, parts:{dim:'origin'|'process', key:string, n:number, pts:number, text:string}[]}}
 */
export function exploreBonus({ country, process }, counts) {
  const parts = [];
  const add = (dim, key, label) => {
    if (!key) return;
    const n = counts[dim].get(key) ?? 0;
    if (n >= FEW_CUPS) return;
    const pts = n === 0 ? EXPLORE_BONUS[dim] : EXPLORE_BONUS[dim] / 2;
    const text = n === 0 ? `まだ飲んだことのない${label}（${key}）` : `あまり飲んでいない${label}（${key}、${n}杯）`;
    parts.push({ dim, key, n, pts, text });
  };
  add('origin', clean(country), '産地');
  add('process', clean(process), '精製');
  return { pts: r2(parts.reduce((s, p) => s + p.pts, 0)), parts };
}

/**
 * おすすめの焙煎度
 * @param {{country:string, fallback:string, fallbackWhy:string}} p
 * @returns {{level:string, why:string, source:'compare'|'cell'|'fallback'|'none'}}
 */
export function recommendRoast({ country, fallback = '', fallbackWhy = '' }, { prefs, heat }) {
  const c = clean(country);
  if (c) {
    const pref = preferenceForBean(prefs, { origin: { country: c } });
    if (pref?.best) return { level: pref.best, why: `${pref.label}の焙煎度比較で好き・${pref.experiments}回`, source: 'compare' };
    const row = heat.cells?.[c];
    if (row) {
      const best = Object.entries(row)
        .filter(([, v]) => v && v.n >= ROAST_CELL_MIN)
        .sort((a, b) => b[1].score - a[1].score || b[1].n - a[1].n)[0];
      if (best) return { level: best[0], why: `${c}×${best[0]}の好みが★${r1(best[1].score)}・${best[1].n}杯`, source: 'cell' };
    }
  }
  if (fallback) return { level: fallback, why: fallbackWhy, source: 'fallback' };
  return { level: '', why: '', source: 'none' };
}

/** これまでに買った豆を銘柄でまとめる（古い袋から順に読み、新しい袋の値で上書き） */
function pastGroups(beans, brews, tastings) {
  const groups = new Map();
  const list = beans.filter(alive).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const b of list) {
    const k = nameKey(b);
    if (!k) continue;
    const g = groups.get(k) ?? { key: `p:${k}`, nameKey: k, beanIds: new Set(), bags: 0, inStock: false, roastStars: new Map() };
    g.bags += 1;
    g.beanIds.add(b.id);
    if (b.status !== 'finished') g.inStock = true;
    g.name = b.name;
    g.country = clean(b.origin?.country) || g.country || '';
    g.process = clean(b.process) || g.process || '';
    g.lastRoast = b.roastLevel || g.lastRoast || '';
    g.productUrl = b.productUrl || g.productUrl || '';
    if (b.labelWeightG != null) {
      g.labelWeightG = b.labelWeightG;
      g.labelWeightBasis = b.labelWeightBasis === 'roasted' ? 'roasted' : 'green';
      g.priceJpy = b.priceJpy ?? null;
    }
    g.lastBoughtYmd = b.orderDate || b.arrivalDate || String(b.createdAt ?? '').slice(0, 10) || null;
    groups.set(k, g);
  }
  const beanOf = new Map(list.map((b) => [b.id, b]));
  for (const br of brews.filter(alive)) {
    const bean = beanOf.get(br.beanId);
    const g = bean && groups.get(nameKey(bean));
    if (!g) continue;
    const s = pickTasting(tastings, br.id)?.stars;
    if (!Number.isFinite(s)) continue;
    (g.stars ??= []).push(s);
    if (bean.roastLevel) {
      const rs = g.roastStars.get(bean.roastLevel) ?? [];
      rs.push(s);
      g.roastStars.set(bean.roastLevel, rs);
    }
  }
  return groups;
}

/** この豆でいちばん★の平均が高い焙煎度（2杯以上）。なければ前回の焙煎度 */
function ownRoast(g) {
  const best = [...g.roastStars.entries()].filter(([, ys]) => ys.length >= 2).sort((a, b) => mean(b[1]) - mean(a[1]) || b[1].length - a[1].length)[0];
  if (best && g.roastStars.size > 1) return { level: best[0], why: `この豆の${best[0]}が★${r1(mean(best[1]))}でいちばん` };
  return g.lastRoast ? { level: g.lastRoast, why: '前回と同じ' } : null;
}

/**
 * 次に買う豆の候補（点数の高い順）
 * @param {{beans?:object[], brews?:object[], tastings?:object[], experiments?:object[], wishlist?:object[]}} data
 * @returns {{key:string, source:'wish'|'past', wishId:string|null, name:string, country:string, process:string,
 *   roastLevel:string, roastWhy:string, predicted:number, bonus:number, score:number, badge:'explore'|'steady'|null,
 *   reasons:string[], avgStars:number|null, rated:number, bags:number, inStock:boolean, productUrl:string,
 *   labelWeightG:number|null, labelWeightBasis:string, priceJpy:number|null, priceTable:object[], lastBoughtYmd:string|null}[]}
 */
export function nextBeanCandidates({ beans = [], brews = [], tastings = [], experiments = [], wishlist = [] } = {}, { max = NEXT_BEAN_MAX } = {}) {
  const rated = ratedRows(analysisRows({ brews, beans, tastings }));
  const allMean = mean(rated.map((r) => r.stars)) ?? NEUTRAL_STARS;
  const dims = [
    ['産地', preferenceBy(rated, 'origin')],
    ['精製', preferenceBy(rated, 'process')],
    ['焙煎度', preferenceBy(rated, 'roastLevel')],
  ];
  const ctx = { prefs: roastPreferences(experiments, beans), heat: heatmap(rated, 'origin', 'roastLevel') };
  const counts = cupCounts(brews, beans);

  /** 産地・精製・焙煎度の嗜好スコアの平均（当てはまる区分だけ） */
  const attrPrior = (vals) => {
    const found = [];
    vals.forEach((v, i) => {
      const hit = v ? dims[i][1].find((x) => x.key === v) : null;
      if (hit) found.push({ key: v, score: hit.score });
    });
    return found.length ? { stars: mean(found.map((f) => f.score)), keys: found.map((f) => f.key) } : null;
  };

  const groups = pastGroups(beans, brews, tastings);
  const { open } = splitWishlist(wishlist, beans);
  const items = [];
  const usedGroups = new Set();
  for (const w of open) {
    const g = groups.get(nameKey(w));
    if (g) usedGroups.add(g.nameKey);
    items.push({ wish: w, group: g ?? null });
  }
  for (const g of groups.values()) if (!usedGroups.has(g.nameKey)) items.push({ wish: null, group: g });

  const out = items.map(({ wish, group }) => {
    const country = clean(wish?.origin?.country) || group?.country || '';
    const process = clean(wish?.process) || group?.process || '';
    const own = group?.stars ?? [];
    const fb = group ? ownRoast(group) : null;
    const roast = recommendRoast(
      { country, fallback: fb?.level || clean(wish?.roastLevel), fallbackWhy: fb?.why || (wish?.roastLevel ? '店の標準' : '') },
      ctx,
    );
    const prior = attrPrior([country, process, roast.level]);
    const priorStars = prior?.stars ?? allMean;
    const ownMean = own.length ? mean(own) : null;
    const predicted = bayesScore(own.length, ownMean, priorStars, OWN_PRIOR_WEIGHT);
    const bonus = exploreBonus({ country, process }, counts);
    const head = own.length
      ? `この豆の★平均 ${r1(ownMean)}（${own.length}杯）`
      : prior
        ? `好み（${prior.keys.join('・')}）から★${r1(priorStars)}と予想`
        : rated.length
          ? `似た豆の記録がないので、全体の平均★${r1(allMean)}で予想`
          : 'まだ評価がないので、★3で予想';
    const reasons = [head, ...[...bonus.parts].sort((a, b) => b.pts - a.pts).slice(0, 1).map((p) => p.text)];
    const badge = bonus.pts >= EXPLORE_BADGE_MIN ? 'explore' : own.length ? 'steady' : null;
    const src = wish ?? {};
    return {
      key: wish ? `w:${wish.id}` : group.key,
      source: wish ? 'wish' : 'past',
      wishId: wish?.id ?? null,
      name: clean(wish?.name) || group?.name || '',
      country,
      process,
      roastLevel: roast.level,
      roastWhy: roast.why,
      predicted: r1(predicted),
      bonus: bonus.pts,
      score: r2(predicted + bonus.pts),
      badge,
      reasons,
      avgStars: ownMean == null ? null : r1(ownMean),
      rated: own.length,
      bags: group?.bags ?? 0,
      inStock: group?.inStock ?? false,
      productUrl: clean(src.productUrl) || group?.productUrl || '',
      labelWeightG: src.labelWeightG ?? group?.labelWeightG ?? null,
      labelWeightBasis: wish ? 'green' : group?.labelWeightBasis ?? 'green',
      priceJpy: src.priceJpy ?? group?.priceJpy ?? null,
      priceTable: src.priceTable ?? [],
      lastBoughtYmd: group?.lastBoughtYmd ?? null,
    };
  });
  return out
    .sort((a, b) => b.score - a.score || b.rated - a.rated || a.name.localeCompare(b.name, 'ja'))
    .slice(0, max);
}

/**
 * 注文する量（生豆時のg）：飲むペースの ORDER_DAYS 日分を、選んだ豆の数で分け、GREEN_STEP_G 単位に切り上げる。
 * 冷凍庫の空きがわかっていれば、ROOM_DAYS 日を超える分が空きに入るまで減らす。ペースがわからなければ候補の表記重量（なければ100g）。
 * @param {{picked:object[], plan:object, beans?:object[], freeSlots?:number|null, doseG?:number}} p plan は restockPlan の値
 * @returns {{grams:Map<string, number>, basis:'pace'|'label', days:number, trimmed:boolean}}
 */
export function orderGrams({ picked = [], plan = {}, beans = [], freeSlots = null, doseG = 15 }) {
  const grams = new Map();
  const pace = plan?.gPerDay > 0 ? plan.gPerDay : null;
  if (!pace || !picked.length) {
    for (const c of picked) grams.set(c.key, c.labelWeightBasis === 'green' && c.labelWeightG > 0 ? c.labelWeightG : GREEN_STEP_G);
    return { grams, basis: 'label', days: ORDER_DAYS, trimmed: false };
  }
  let roastedG = pace * ORDER_DAYS;
  let trimmed = false;
  if (Number.isInteger(freeSlots) && doseG > 0) {
    const cap = pace * ROOM_DAYS + freeSlots * doseG;
    if (roastedG > cap) {
      roastedG = cap;
      trimmed = true;
    }
  }
  const each = roastedG / picked.length;
  for (const c of picked) {
    const loss = lossPct(c.roastLevel, beans).pct;
    const green = each / (1 - loss / 100);
    grams.set(c.key, Math.max(GREEN_STEP_G, Math.ceil(green / GREEN_STEP_G - 1e-9) * GREEN_STEP_G));
  }
  return { grams, basis: 'pace', days: Math.round(roastedG / pace), trimmed };
}

/** その量の値段（価格表にあればその値、なければ表記の値段から比例で見積もる）。わからなければ null */
export function priceForGrams(c, g) {
  const hit = (c.priceTable ?? []).find((r) => r.g === g);
  if (hit) return { priceJpy: hit.priceJpy, estimated: false };
  if (c.priceJpy != null && c.labelWeightG > 0 && c.labelWeightBasis === 'green') {
    if (c.labelWeightG === g) return { priceJpy: c.priceJpy, estimated: false };
    return { priceJpy: Math.round((c.priceJpy * g) / c.labelWeightG), estimated: true };
  }
  return null;
}

/**
 * 注文メモ（いつまでに・何を・どの焙煎度で・何g）
 * @param {object[]} picked nextBeanCandidates から選んだもの
 * @param {object} plan restockPlan の値
 * @param {{grams:Map<string,number>, basis:string, days:number, trimmed:boolean}} amounts orderGrams の値
 */
export function nextBeanMemo(picked, plan, amounts) {
  const head = plan?.orderByYmd && plan.status !== 'unknown' ? `珈琲問屋 注文メモ（${formatYmdJa(plan.orderByYmd)}までに）` : '珈琲問屋 注文メモ';
  const lines = picked.map((c) => {
    const g = amounts?.grams?.get(c.key);
    const price = g ? priceForGrams(c, g) : null;
    const weight = g ? `生豆時${g}g` : '';
    const yen = price ? `${price.estimated ? '約' : ''}${price.priceJpy.toLocaleString('ja-JP')}円` : '';
    const note = c.avgStars != null ? `前回 ★${c.avgStars}` : c.badge === 'explore' ? '初めて' : '';
    return `・${[c.name, c.roastLevel ? `${c.roastLevel}ロースト` : '', weight, yen].filter(Boolean).join(' ')}${note ? `（${note}）` : ''}`;
  });
  const foot = [];
  if (amounts?.basis === 'pace') {
    foot.push(`量は飲むペースの${amounts.days}日分を${picked.length}種で分けた目安${amounts.trimmed ? '（冷凍庫の空きに合わせて減らした）' : ''}`);
  }
  return [head, ...lines, ...foot].join('\n');
}
