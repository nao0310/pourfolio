// コスト管理（C6、純粋関数）
// - 1杯の原価 ＝ 粉量 × 豆の1gあたりの値段（spec 5.1）
//   1gあたり ＝ 価格 ÷ 到着時に量った重さ（量っていなければ、表記重量から見積もった焙煎後の重さ）
//   送料は1杯の原価に入れない（月の支出には入れる）
// - 月の支出は「買った月」（豆の価格＋注文の送料）と「飲んだ月」（その月の抽出の原価の合計）の両方を出す
// - 満足度あたりの費用 ＝ 1杯の平均単価 ÷ 平均★（★1つあたりの円。小さいほど割安）

import { initialStockG } from './roast.js';
import { pickTasting } from './tastings.js';
import { localYmd } from './format.js';

const alive = (r) => r && r.deletedAt == null;
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/** 月の表を出す月数（今月を含む） */
export const COST_MONTHS = 6;

/** まとめる切り口 */
export const COST_GROUPS = Object.freeze({
  name: '銘柄',
  roastLevel: '焙煎度',
  shop: '購入先',
});

/**
 * 豆の1gあたりの値段
 * @param {object} bean
 * @param {object[]} [beans] 目減り率の学習に使う豆の一覧
 * @returns {{yenPerG:number, estimated:boolean}|null} 価格か重さがわからなければ null
 */
export function gramPrice(bean, beans = []) {
  if (!bean || bean.priceJpy == null || !(Number(bean.priceJpy) >= 0)) return null;
  const stock = initialStockG(bean, beans);
  if (!stock || !(stock.g > 0)) return null;
  return { yenPerG: bean.priceJpy / stock.g, estimated: Boolean(stock.estimated) };
}

/**
 * 1杯の原価（円、小数1桁）
 * @param {object} brew
 * @param {object|null} bean
 * @param {object[]} [beans]
 * @returns {number|null} 豆・粉量・価格のどれかがわからなければ null
 */
export function brewCostJpy(brew, bean, beans = []) {
  const dose = Number(brew?.actual?.doseG);
  if (!(dose > 0)) return null;
  const gp = gramPrice(bean, beans);
  return gp ? round1(dose * gp.yenPerG) : null;
}

/** 「2026-11」 */
const monthOf = (ymd) => (typeof ymd === 'string' && /^\d{4}-\d{2}/.test(ymd) ? ymd.slice(0, 7) : null);

/** 豆を買った日：注文日 → 到着日 → 登録日 */
export function boughtYmd(bean) {
  return bean.orderDate || bean.arrivalDate || (bean.createdAt ? localYmd(bean.createdAt) : null);
}

/** 「2026-11」から n か月前の「2026-06」 */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 月ごとの支出（新しい月が上。今月から COST_MONTHS か月分。記録のない月も0で出す）
 * @param {{beans:object[], orders?:object[], brews?:object[], today:string, months?:number}} p
 * @returns {{month:string, beansJpy:number, shippingJpy:number, boughtJpy:number, bags:number, unpricedBags:number,
 *   drankJpy:number, cups:number, uncostedCups:number}[]}
 */
export function monthlySpending({ beans = [], orders = [], brews = [], today, months = COST_MONTHS }) {
  const list = beans.filter(alive);
  const thisMonth = monthOf(today);
  const rows = new Map();
  for (let i = 0; i < months; i += 1) {
    const month = addMonths(thisMonth, -i);
    rows.set(month, { month, beansJpy: 0, shippingJpy: 0, boughtJpy: 0, bags: 0, unpricedBags: 0, drankJpy: 0, cups: 0, uncostedCups: 0 });
  }
  for (const b of list) {
    const row = rows.get(monthOf(boughtYmd(b)));
    if (!row) continue;
    row.bags += 1;
    if (b.priceJpy == null) row.unpricedBags += 1;
    else row.beansJpy += b.priceJpy;
  }
  for (const o of orders.filter(alive)) {
    const row = rows.get(monthOf(o.orderDate));
    if (row && Number(o.shippingJpy) > 0) row.shippingJpy += o.shippingJpy;
  }
  const beanOf = new Map(list.map((b) => [b.id, b]));
  for (const br of brews.filter(alive)) {
    const row = rows.get(monthOf(localYmd(br.at)));
    if (!row || !(Number(br.actual?.doseG) > 0)) continue;
    const cost = brewCostJpy(br, beanOf.get(br.beanId), list);
    row.cups += 1;
    if (cost == null) row.uncostedCups += 1;
    else row.drankJpy += cost;
  }
  return [...rows.values()].map((r) => ({ ...r, boughtJpy: r.beansJpy + r.shippingJpy, drankJpy: Math.round(r.drankJpy) }));
}

/**
 * 切り口（銘柄・焙煎度・購入先）ごとの1杯の平均単価と満足度あたりの費用
 * 1杯の平均単価は原価がわかる杯だけ、平均★は評価のある杯だけで出す。
 * @param {{beans:object[], brews:object[], tastings?:object[], by:'name'|'roastLevel'|'shop'}} p
 * @returns {{key:string, label:string, cups:number, avgCostJpy:number|null, avgStars:number|null, rated:number, yenPerStar:number|null}[]}
 *   杯数の多い順
 */
export function costByGroup({ beans = [], brews = [], tastings = [], by = 'name' }) {
  const list = beans.filter(alive);
  const beanOf = new Map(list.map((b) => [b.id, b]));
  const groups = new Map();
  for (const br of brews.filter(alive)) {
    const bean = beanOf.get(br.beanId);
    if (!bean) continue;
    const label = groupLabel(bean, by);
    const key = groupKey(label);
    const g = groups.get(key) ?? { key, label, cups: 0, costSum: 0, costed: 0, starSum: 0, rated: 0 };
    g.cups += 1;
    const cost = brewCostJpy(br, bean, list);
    if (cost != null) {
      g.costSum += cost;
      g.costed += 1;
    }
    const stars = pickTasting(tastings, br.id)?.stars;
    if (typeof stars === 'number' && stars > 0) {
      g.starSum += stars;
      g.rated += 1;
    }
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const avgCostJpy = g.costed ? round1(g.costSum / g.costed) : null;
      const avgStars = g.rated ? round2(g.starSum / g.rated) : null;
      return {
        key: g.key,
        label: g.label,
        cups: g.cups,
        avgCostJpy,
        avgStars,
        rated: g.rated,
        yenPerStar: avgCostJpy != null && avgStars ? round1(avgCostJpy / avgStars) : null,
      };
    })
    .sort((a, b) => b.cups - a.cups || Number(a.label === UNKNOWN) - Number(b.label === UNKNOWN) || String(a.label).localeCompare(String(b.label), 'ja'));
}

const UNKNOWN = '（未入力）';

/** 切り口ごとの見出し（空なら「（未入力）」） */
function groupLabel(bean, by) {
  const v = by === 'roastLevel' ? bean.roastLevel : by === 'shop' ? bean.shop : bean.name;
  const s = String(v ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  return s || UNKNOWN;
}

/** まとめるときの鍵（全角・半角、大文字・小文字、空白の違いを同じにする） */
export function groupKey(label) {
  return String(label ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * コストのまとめ：直近30日の杯数・1杯の平均単価、今月の買った額・飲んだ額
 * @returns {{cups30:number, avgCost30:number|null, costed30:number, thisMonth:object}}
 */
export function costSummary({ beans = [], orders = [], brews = [], today }) {
  const list = beans.filter(alive);
  const beanOf = new Map(list.map((b) => [b.id, b]));
  const from = new Date(`${today}T00:00:00`).getTime() - 29 * 86400000;
  let cups30 = 0;
  let costed30 = 0;
  let sum = 0;
  for (const br of brews.filter(alive)) {
    if (new Date(br.at).getTime() < from || localYmd(br.at) > today) continue;
    if (!(Number(br.actual?.doseG) > 0)) continue;
    cups30 += 1;
    const cost = brewCostJpy(br, beanOf.get(br.beanId), list);
    if (cost != null) {
      costed30 += 1;
      sum += cost;
    }
  }
  const [thisMonth] = monthlySpending({ beans, orders, brews, today, months: 1 });
  return { cups30, costed30, avgCost30: costed30 ? round1(sum / costed30) : null, thisMonth };
}

/** 円の表示「1,234円」（小数は四捨五入） */
export function yen(n) {
  if (n == null || Number.isNaN(n)) return '';
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

/** 1gあたりの表示「6.1円/g」 */
export function yenPerGText(gp) {
  if (!gp) return '';
  return `${(Math.round(gp.yenPerG * 10) / 10).toFixed(1)}円/g${gp.estimated ? '（見積もりの重さ）' : ''}`;
}
