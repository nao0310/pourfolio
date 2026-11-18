// 未来の自分への申し送り（X32、純粋関数）
// 新しい袋を開けたとき、同じ銘柄の前の袋（なければ似た豆）の、★がいちばん高かった条件・評価のメモ・飲み頃の山と、
// 飲み切りのときに書いた「次の自分への一言」（豆の handoverNote）を集める。保存はせず表示のたびに計算する（D-172）。

import { nameKey } from './compare.js';
import { similarity, SIMILAR_MIN_SCORE } from './initial-recipe.js';
import { pickTasting } from './tastings.js';
import { isIced } from './plan-adjust.js';
import { analysisRows } from './analysis.js';
import { agingOf } from './aging.js';
import { ratioOf } from './recipes.js';
import { localYmd, formatYmdJa } from './format.js';

/** 申し送りを出すのは、この袋で淹れた杯がこれより少ないあいだ */
export const HANDOVER_SHOW_CUPS = 3;
/** 出すメモの数 */
export const HANDOVER_MEMOS = 3;
/** 次の自分への一言の長さの上限（文字） */
export const HANDOVER_NOTE_MAX = 200;

const alive = (r) => r && r.deletedAt == null;
const clean = (v) => String(v ?? '').normalize('NFKC').trim();
/** 自由に書いた文（メモ・一言）は、℃などが変わらないよう前後の空白だけ除く */
const text = (v) => String(v ?? '').trim();

/** 次の自分への一言を整える */
export function normalizeHandoverNote(text) {
  const v = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  return v.length > HANDOVER_NOTE_MAX ? { value: null, error: `一言は${HANDOVER_NOTE_MAX}文字までにしてください` } : { value: v, error: '' };
}

/** 豆の袋の集まりで、★のある杯（アイスを除く）。古い順 */
function ratedOf(brews, tastings, ids) {
  return (brews ?? [])
    .filter((b) => alive(b) && ids.has(b.beanId) && !isIced(b))
    .map((b) => ({ brew: b, tasting: pickTasting(tastings, b.id) }))
    .filter((x) => Number.isFinite(x.tasting?.stars))
    .map((x) => ({ ...x, stars: x.tasting.stars }))
    .sort((a, b) => String(a.brew.at).localeCompare(String(b.brew.at)));
}

/** ★がいちばん高い杯（同じなら新しい杯） */
function bestOf(list) {
  return list.length ? list.reduce((a, b) => (b.stars > a.stars || (b.stars === a.stars && String(b.brew.at) >= String(a.brew.at)) ? b : a)) : null;
}

/**
 * ベストの条件（実際に淹れた値）
 * @returns {{brewId:string, beanId:string, stars:number, at:string, doseG:number|null, waterG:number|null, ratio:number|null,
 *   tempC:number|null, grindSetting:string, grinderId:string|null, totalSec:number|null, daysOffRoast:number|null, recipeName:string}}
 */
export function bestConditions(entry) {
  const b = entry.brew;
  const a = b.actual ?? {};
  const p = b.planned ?? {};
  const num = (v) => (Number.isFinite(v) ? v : null);
  const doseG = num(a.doseG) ?? num(p.doseG);
  const waterG = num(a.waterG) ?? num(p.waterG);
  return {
    brewId: b.id,
    beanId: b.beanId,
    stars: entry.stars,
    at: String(b.at ?? ''),
    doseG,
    waterG,
    ratio: num(b.derived?.ratio) ?? (doseG && waterG ? ratioOf(doseG, waterG) : null),
    tempC: num(a.tempC) ?? num(p.tempC),
    grindSetting: clean(a.grind?.setting ?? p.grind?.setting),
    grinderId: a.grind?.grinderId ?? p.grind?.grinderId ?? null,
    totalSec: num(a.totalSec),
    daysOffRoast: num(b.derived?.daysOffRoast),
    recipeName: clean(p.name),
  };
}

const mmss = (sec) => `${Math.floor(sec / 60)}分${String(Math.round(sec % 60)).padStart(2, '0')}秒`;

/** 条件の1行「15g・1:16・92℃・挽き目 22・3分05秒」 */
export function conditionsText(c, grinderName = '') {
  const parts = [];
  if (c.doseG != null) parts.push(`${c.doseG}g`);
  if (c.ratio != null) parts.push(`1:${c.ratio}`);
  if (c.tempC != null) parts.push(`${c.tempC}℃`);
  if (c.grindSetting) parts.push(`挽き目 ${c.grindSetting}${grinderName ? `（${grinderName}）` : ''}`);
  if (c.totalSec != null) parts.push(mmss(c.totalSec));
  return parts.join('・');
}

/** ベストの見出し「★5（11/2、焙煎12日）」 */
export function bestHead(c) {
  const when = [formatYmdJa(localYmd(c.at)), c.daysOffRoast != null ? `焙煎${c.daysOffRoast}日` : ''].filter(Boolean).join('、');
  return `★${c.stars}${when ? `（${when}）` : ''}`;
}

/**
 * 申し送り
 * @param {{bean:object, beans:object[], brews:object[], tastings:object[]}} p
 * @returns {null|{source:'same'|'similar', fromBeans:object[], fromLabel:string, why:string[], best:ReturnType<typeof bestConditions>|null,
 *   bestBean:object|null, roastNote:string, notes:{text:string, beanName:string, ymd:string}[], memos:{text:string, stars:number, ymd:string}[],
 *   peak:{label:string, mean:number}|null, cups:number}}
 *   出せるもの（ベスト・一言・メモ）が何もなければ null
 */
export function handoverFor({ bean, beans = [], brews = [], tastings = [] }) {
  if (!bean) return null;
  const others = (beans ?? []).filter((b) => alive(b) && b.id !== bean.id);
  const key = nameKey(bean);
  const same = key ? others.filter((b) => nameKey(b) === key) : [];
  let source = 'same';
  let fromBeans = same;
  let why = [];
  const hasSomething = (list) =>
    list.length > 0 && (ratedOf(brews, tastings, new Set(list.map((b) => b.id))).length > 0 || list.some((b) => text(b.handoverNote)));
  if (!hasSomething(same)) {
    // 似た豆：点数のいちばん高い豆1つ（同じ点なら新しい豆）。★のある杯か一言があるものだけ
    const cand = others
      .map((b) => ({ b, ...similarity(bean, b) }))
      .filter((x) => x.score >= SIMILAR_MIN_SCORE && hasSomething([x.b]))
      .sort((x, y) => y.score - x.score || String(y.b.createdAt ?? '').localeCompare(String(x.b.createdAt ?? '')));
    if (!cand.length) return null;
    source = 'similar';
    fromBeans = [cand[0].b];
    why = cand[0].why;
  }
  const ids = new Set(fromBeans.map((b) => b.id));
  const rated = ratedOf(brews, tastings, ids);
  const bestEntry = bestOf(rated);
  const best = bestEntry ? bestConditions(bestEntry) : null;
  const bestBean = best ? fromBeans.find((b) => b.id === best.beanId) ?? null : null;
  const roastNote =
    bestBean && bestBean.roastLevel && bean.roastLevel && bestBean.roastLevel !== bean.roastLevel
      ? `前の袋は${bestBean.roastLevel}でした（今回は${bean.roastLevel}）`
      : '';

  // 次の自分への一言：新しい袋の順
  const notes = [...fromBeans]
    .filter((b) => text(b.handoverNote))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .map((b) => ({ text: text(b.handoverNote), beanName: clean(b.name), roastLevel: clean(b.roastLevel), ymd: localYmd(b.handoverNoteAt ?? b.updatedAt ?? '') }));

  // 評価と抽出のメモ：新しい順に HANDOVER_MEMOS 個（★のない杯のメモも入れる）
  const memos = (brews ?? [])
    .filter((b) => alive(b) && ids.has(b.beanId))
    .map((b) => {
      const t = pickTasting(tastings, b.id);
      const memo = [t?.memo, b.memo].map(text).filter(Boolean).join(' / ');
      return { text: memo, stars: Number.isFinite(t?.stars) ? t.stars : null, at: String(b.at ?? ''), ymd: localYmd(b.at) };
    })
    .filter((m) => m.text)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, HANDOVER_MEMOS)
    .map(({ at, ...rest }) => rest);

  // 飲み頃の山：ベストの袋のエイジング日誌（X31）
  let peak = null;
  if (bestBean) {
    const mine = (brews ?? []).filter((b) => alive(b) && b.beanId === bestBean.id);
    const a = agingOf(bestBean, analysisRows({ brews: mine, beans: [bestBean], tastings }));
    if (a.peak) peak = { label: a.peak.label, mean: a.peak.mean };
  }

  if (!best && !notes.length && !memos.length) return null;
  const fromLabel =
    source === 'same'
      ? `前の袋（${fromBeans.length}袋）から`
      : `似た豆「${clean(fromBeans[0].name)}」から`;
  return { source, fromBeans, fromLabel, why, best, bestBean, roastNote, notes, memos, peak, cups: rated.length };
}

/**
 * 申し送りを出すか：この袋で淹れた杯が HANDOVER_SHOW_CUPS より少なく、飲み切りでない
 * @param {object} bean
 * @param {object[]} brews
 */
export function showHandover(bean, brews = []) {
  if (!bean || bean.status === 'finished') return false;
  const n = (brews ?? []).filter((b) => alive(b) && b.beanId === bean.id).length;
  return n < HANDOVER_SHOW_CUPS;
}

/** 「この条件で淹れる」の行き先 */
export function handoverBrewHref(h, bean) {
  if (!h?.best || !bean) return '';
  return `brew.html?brew=${encodeURIComponent(h.best.brewId)}&bean=${encodeURIComponent(bean.id)}`;
}
