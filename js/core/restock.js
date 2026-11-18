// 買い足し計画（C5、純粋関数）
// 在庫（手元＋入荷待ち）と最近の消費ペースから、なくなる日と注文の目安日を出し、買い物リストを作る。
// 注文の目安日 ＝ なくなる日 − お届け日数 − 休ませる日数（spec 4.4）

import { remainingG, consumptionPace, groupTxByBean } from './inventory.js';
import { initialStockG, roastGroup } from './roast.js';
import { FRESHNESS_WINDOWS, FALLBACK_GROUP } from './freshness.js';
import { deliveryDays, addDaysYmd } from './orders.js';
import { pickTasting } from './tastings.js';
import { formatG, formatYmdJa } from './format.js';
import { groupPortionsByBean, frozenG as sumFrozenG } from './frozen.js';

/** 注文の目安日まで何日以内なら「そろそろ注文」を出すか */
export const RESTOCK_SOON_DAYS = 3;
/** 買い物リストに出す数 */
export const SHOPPING_MAX = 10;

const alive = (r) => r && r.deletedAt == null;
const round1 = (n) => Math.round(n * 10) / 10;

/** 焙煎度ごとの、届いてから飲み頃になるまでの日数（焙煎の翌日に届く前提で、休ませ中の日数） */
export function restDaysFor(roastLevel) {
  const w = FRESHNESS_WINDOWS[roastGroup(roastLevel) ?? FALLBACK_GROUP];
  return Math.max(0, w.restUntil);
}

/**
 * 在庫の合計
 * - 手元：飲み切り・入荷待ちを除く豆の残量（常温はマイナスなら0）＋冷凍庫の袋（C4）
 * - 入荷待ち：表記重量から見積もった焙煎後の重さ
 * @returns {{onHandG:number, frozenG:number, incomingG:number, orderedCount:number}} frozenG は onHandG のうち冷凍の分
 */
export function stockSummary({ beans = [], txs = [], portions = [] }) {
  const byBean = groupTxByBean(txs.filter(alive));
  const portionsByBean = groupPortionsByBean(portions);
  const list = beans.filter(alive);
  let onHandG = 0;
  let frozenG = 0;
  let incomingG = 0;
  let orderedCount = 0;
  for (const b of list) {
    if (b.status === 'finished') continue;
    if (b.status === 'ordered') {
      orderedCount += 1;
      incomingG += initialStockG(b, list)?.g ?? 0;
    } else {
      const fz = sumFrozenG(portionsByBean[b.id]);
      frozenG += fz;
      onHandG += Math.max(0, remainingG(byBean[b.id] ?? [])) + fz;
    }
  }
  return { onHandG: round1(onHandG), frozenG: round1(frozenG), incomingG: round1(incomingG), orderedCount };
}

/** 次に買う豆の焙煎度の見当：買い物リストの先頭、なければ最後に登録した豆 */
function nextRoastLevel(beans, candidates) {
  if (candidates[0]?.roastLevel) return candidates[0].roastLevel;
  const latest = beans.filter((b) => alive(b) && b.roastLevel).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  return latest?.roastLevel ?? '';
}

/**
 * 買い足し計画
 * @param {{beans:object[], txs:object[], portions?:object[], brews?:object[], tastings?:object[], settings?:object, today:string, now?:Date}} p
 * @returns {{status:'unknown'|'ok'|'soon'|'now', gPerDay?:number, onHandG:number, incomingG:number, orderedCount:number,
 *   daysLeft?:number, runoutYmd?:string, orderByYmd?:string, daysUntilOrder?:number,
 *   deliveryDays:number, deliveryLearned:boolean, restDays:number, roastLevel:string}}
 */
export function restockPlan({ beans = [], txs = [], portions = [], brews = [], tastings = [], settings = {}, today, now = new Date() }) {
  const stock = stockSummary({ beans, txs, portions });
  const delivery = deliveryDays(beans, settings?.deliveryDays);
  const roastLevel = nextRoastLevel(beans, shoppingCandidates({ beans, brews, tastings }));
  const restDays = restDaysFor(roastLevel);
  const base = { ...stock, deliveryDays: delivery.days, deliveryLearned: delivery.learned, restDays, roastLevel };
  const pace = consumptionPace(txs.filter(alive), now);
  if (!pace || !(pace.gPerDay > 0)) return { status: 'unknown', ...base };
  const daysLeft = Math.floor((stock.onHandG + stock.incomingG) / pace.gPerDay);
  const daysUntilOrder = daysLeft - delivery.days - restDays;
  let status = 'ok';
  if (daysUntilOrder <= 0) status = 'now';
  else if (daysUntilOrder <= RESTOCK_SOON_DAYS) status = 'soon';
  return {
    status,
    gPerDay: pace.gPerDay,
    ...base,
    daysLeft,
    runoutYmd: addDaysYmd(today, daysLeft),
    orderByYmd: addDaysYmd(today, Math.max(0, daysUntilOrder)),
    daysUntilOrder,
  };
}

/** 「お届け5日＋休ませ2日」 */
function leadText(plan) {
  const parts = [`お届け${plan.deliveryDays}日`];
  if (plan.restDays > 0) parts.push(`休ませ${plan.restDays}日`);
  return parts.join('＋');
}

/**
 * トップと買い物リストに出す文
 * @returns {{title:string, text:string}}
 */
export function restockText(plan) {
  if (plan.status === 'unknown') {
    return { title: '買い足しの目安', text: '2週間で2杯以上淹れると、注文の目安日を出します' };
  }
  const incl = [plan.frozenG > 0 ? '冷凍' : '', plan.incomingG > 0 ? '入荷待ち' : ''].filter(Boolean).join('・');
  const stock = `在庫はあと約${plan.daysLeft}日分（1日${formatG(plan.gPerDay)}のペース${incl ? `・${incl}を含む` : ''}）`;
  if (plan.status === 'now') {
    return { title: '今日、注文しましょう', text: `${stock}。今日注文すると、${leadText(plan)}でちょうど切らさずに済みます` };
  }
  if (plan.status === 'soon') {
    return { title: `そろそろ注文：${formatYmdJa(plan.orderByYmd)}までに`, text: `${stock}。${leadText(plan)}を見込んでいます` };
  }
  return { title: `次の注文は${formatYmdJa(plan.orderByYmd)}ごろ`, text: `${stock}。${leadText(plan)}を見込んでいます` };
}

/**
 * 買い物リストの候補：これまでに買った豆を「銘柄＋焙煎度」でまとめ、評価の高い順に並べる
 * @returns {{key:string, name:string, roastLevel:string, bags:number, avgStars:number|null, rated:number,
 *   productUrl:string, labelWeightG:number|null, labelWeightBasis:string, priceJpy:number|null, lastBoughtYmd:string|null, inStock:boolean}[]}
 */
export function shoppingCandidates({ beans = [], brews = [], tastings = [] }) {
  const groups = new Map();
  const list = beans.filter(alive).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const b of list) {
    const key = `${b.name}\u0000${b.roastLevel ?? ''}`;
    const g = groups.get(key) ?? { key, name: b.name, roastLevel: b.roastLevel ?? '', beanIds: new Set(), bags: 0, inStock: false };
    g.bags += 1;
    g.beanIds.add(b.id);
    if (b.status !== 'finished') g.inStock = true;
    // 新しい袋の値で上書きする（URLは空なら前の値を残す）
    g.productUrl = b.productUrl || g.productUrl || '';
    g.labelWeightG = b.labelWeightG ?? g.labelWeightG ?? null;
    g.labelWeightBasis = b.labelWeightG != null ? b.labelWeightBasis : (g.labelWeightBasis ?? 'green');
    g.priceJpy = b.priceJpy ?? g.priceJpy ?? null;
    g.lastBoughtYmd = b.orderDate || b.arrivalDate || String(b.createdAt ?? '').slice(0, 10) || null;
    groups.set(key, g);
  }
  const brewsAlive = brews.filter(alive);
  const out = [];
  for (const g of groups.values()) {
    const stars = brewsAlive
      .filter((br) => g.beanIds.has(br.beanId))
      .map((br) => pickTasting(tastings, br.id)?.stars)
      .filter((s) => typeof s === 'number');
    const { beanIds, ...rest } = g;
    out.push({ ...rest, avgStars: stars.length ? round1(stars.reduce((s, x) => s + x, 0) / stars.length) : null, rated: stars.length });
  }
  return out
    .sort(
      (a, b) =>
        (b.avgStars ?? -1) - (a.avgStars ?? -1) ||
        b.rated - a.rated ||
        String(b.lastBoughtYmd ?? '').localeCompare(String(a.lastBoughtYmd ?? '')),
    )
    .slice(0, SHOPPING_MAX);
}

/**
 * 注文メモ（店のサイトを見ながら注文するためのコピー用の文）
 * @param {object[]} picked shoppingCandidates の中から選んだもの
 * @param {object} plan restockPlan の値
 */
export function orderMemo(picked, plan) {
  const head = plan?.orderByYmd && plan.status !== 'unknown' ? `珈琲問屋 注文メモ（${formatYmdJa(plan.orderByYmd)}までに）` : '珈琲問屋 注文メモ';
  const lines = picked.map((c) => {
    const weight = c.labelWeightG ? `${formatG(c.labelWeightG)}${c.labelWeightBasis === 'roasted' ? '（焙煎後）' : ''}` : '';
    const stars = c.avgStars != null ? `前回 ★${c.avgStars}` : '';
    return `・${[c.name, c.roastLevel, weight].filter(Boolean).join(' ')}${stars ? `（${stars}）` : ''}`;
  });
  return [head, ...lines].join('\n');
}
