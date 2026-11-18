// 今日の一杯（F3、spec 6.4）：手元の豆ごとに点数を付け、上位3つを理由と一緒に出す（純粋関数）
// 点数＝予測評価（★の目安）＋飲み頃・在庫・気分（F4）・カフェインの補正。
// 淹れ方は、その豆で★がいちばん高かった杯の計画。まだ淹れていない豆は初期レシピ（F2）。

import { bayesScore, preferenceBy } from './preference.js';
import { mean } from './chart-scale.js';
import { pickTasting } from './tastings.js';
import { roastGroup, ROAST_GROUPS } from './roast.js';
import { MOODS, isIced, adjustQuery } from './plan-adjust.js';

const alive = (r) => r && r.deletedAt == null;
const r1 = (n) => Math.round(n * 10) / 10;

/** 予測評価で、自分の豆の★をどれだけ信じるか（ベイズ平均の重み。小さいほど自分の★が早く効く） */
export const OWN_PRIOR_WEIGHT = 3;
/** 1日のカフェインの目安の上限（mg）。健康な大人の目安。これを超えたら控える */
export const DAILY_CAFFEINE_MG = 400;
/** 評価がまったくないときの予測評価 */
export const NEUTRAL_STARS = 3;

/** 補正の点数（★の単位） */
export const ADJUST = Object.freeze({
  peak: 0.3,
  resting: -0.5,
  useSoon: 0.4,
  frozenOnly: -0.3,
  lowStock: 0.2,
  moodFit: 0.3,
  guestSteady: 0.4,
  guestUntried: -0.3,
  decafLate: 1.0,
  caffeineLate: -0.5,
});

/** 'HH:MM' を分にする。読めなければ null */
export function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/** 'HH:MM' の形に直す（読めなければ null） */
export function normalizeCutoff(v) {
  const s = String(v ?? '').normalize('NFKC').trim();
  const m = minutesOf(s);
  if (m == null) return null;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * カフェインを控える状態か
 * @param {{now:Date, cutoff?:string|null, todayCaffeineMg?:number}} p
 * @returns {{late:boolean, why:string}}
 */
export function caffeineState({ now, cutoff = null, todayCaffeineMg = 0 }) {
  const c = minutesOf(cutoff);
  const cur = now.getHours() * 60 + now.getMinutes();
  // 夜中（0〜4時）は前の日の続きとして、控える時間に入れる
  if (c != null && (cur >= c || now.getHours() < 5)) return { late: true, why: `${cutoff}を過ぎたのでカフェインを控える時間です` };
  if (todayCaffeineMg >= DAILY_CAFFEINE_MG) return { late: true, why: `今日のカフェインが約${todayCaffeineMg}mgで、目安の${DAILY_CAFFEINE_MG}mgに届きました` };
  return { late: false, why: '' };
}

/** 豆ごとの★（温かいうちの評価）。古い順 */
function starsByBean(brews, tastings) {
  const out = new Map();
  for (const b of brews) {
    if (!alive(b) || !b.beanId) continue;
    const t = pickTasting(tastings, b.id);
    if (!Number.isFinite(t?.stars)) continue;
    if (!out.has(b.beanId)) out.set(b.beanId, []);
    out.get(b.beanId).push({ brew: b, stars: t.stars });
  }
  return out;
}

/** その豆で★がいちばん高かった杯（アイスは除く。同じ★なら新しい杯） */
export function bestBrewOf(list = []) {
  const hot = list.filter((x) => !isIced(x.brew));
  if (!hot.length) return null;
  return hot.reduce((a, b) => (b.stars > a.stars || (b.stars === a.stars && String(b.brew.at) > String(a.brew.at)) ? b : a)).brew;
}

/**
 * 産地・精製・焙煎度の好み（嗜好スコア）から、まだ飲んでいない豆の★を予測する
 * @returns {{stars:number, keys:string[]}|null}
 */
function attrPrediction(bean, prefs) {
  const found = [];
  for (const [dim, list, of] of prefs) {
    const k = of(bean);
    const hit = k ? list.find((x) => x.key === k) : null;
    if (hit) found.push({ dim, key: k, score: hit.score });
  }
  if (!found.length) return null;
  return { stars: mean(found.map((f) => f.score)), keys: found.map((f) => f.key) };
}

/**
 * 今日の一杯の候補（点数の高い順）。
 * @param {{rows:object[], brews?:object[], tastings?:object[], beans?:object[], now?:Date, mood?:string|null,
 *   cutoff?:string|null, todayCaffeineMg?:number, n?:number}} p rows は home.js の beanRows の結果
 * @returns {{bean:object, score:number, predicted:number, reasons:string[], base:{kind:'brew', brewId:string}|{kind:'initial'}, cups:number, mood:string|null, n:number}[]}
 */
export function todayPicks({ rows = [], brews = [], tastings = [], beans = [], now = new Date(), mood = null, cutoff = null, todayCaffeineMg = 0, n = 3 }) {
  const stars = starsByBean(brews, tastings);
  const ratedRows = [];
  const beanOf = new Map(beans.filter(alive).map((b) => [b.id, b]));
  for (const [beanId, list] of stars) for (const x of list) ratedRows.push({ bean: beanOf.get(beanId) ?? null, stars: x.stars });
  const allMean = mean(ratedRows.map((r) => r.stars)) ?? NEUTRAL_STARS;
  const clean = (v) => String(v ?? '').normalize('NFKC').trim();
  const prefs = [
    ['産地', preferenceBy(ratedRows, 'origin'), (b) => clean(b?.origin?.country)],
    ['精製', preferenceBy(ratedRows, 'process'), (b) => clean(b?.process)],
    ['焙煎度', preferenceBy(ratedRows, 'roastLevel'), (b) => clean(b?.roastLevel)],
  ];
  const caf = caffeineState({ now, cutoff, todayCaffeineMg });
  const m = MOODS[mood] ? MOODS[mood] : null;

  const picks = rows
    .filter((row) => row.cups >= 1)
    .map((row) => {
      const bean = row.bean;
      const own = stars.get(bean.id) ?? [];
      const prior = attrPrediction(bean, prefs);
      const priorStars = prior?.stars ?? allMean;
      const ownMean = own.length ? mean(own.map((x) => x.stars)) : null;
      const predicted = bayesScore(own.length, ownMean, priorStars, OWN_PRIOR_WEIGHT);
      const adj = []; // { pts, text }

      const head = own.length
        ? `この豆の★平均 ${r1(ownMean)}（${own.length}杯）`
        : prior
          ? `まだ評価がないので、好み（${prior.keys.join('・')}）から★${r1(prior.stars)}と予測`
          : 'まだ評価がない豆です';

      const f = row.freshness;
      if (row.frozenOnly) adj.push({ pts: ADJUST.frozenOnly, text: '冷凍の袋だけ残っています（取り出して使います）' });
      else if (f?.stage === 'peak') adj.push({ pts: ADJUST.peak, text: `飲み頃です（焙煎から${f.days}日）` });
      else if (f?.stage === 'resting') adj.push({ pts: ADJUST.resting, text: `まだ休ませ中です（あと${f.next?.inDays ?? 1}日で飲み頃）` });
      else if (f?.stage === 'useSoon') adj.push({ pts: ADJUST.useSoon, text: `早めに使い切りたい豆です（焙煎から${f.days}日）` });

      if (row.cups <= 3) adj.push({ pts: ADJUST.lowStock, text: `残り${row.cups}杯で使い切れます` });

      const group = roastGroup(bean.roastLevel);
      if (m && group && m.roastGroups.includes(group)) adj.push({ pts: ADJUST.moodFit, text: `気分「${m.label}」（${m.aim}）に合う${ROAST_GROUPS[group].label}です` });
      if (mood === 'guest') {
        if (own.length >= 3 && ownMean >= 4) adj.push({ pts: ADJUST.guestSteady, text: `★${r1(ownMean)}が${own.length}杯続いている定番です` });
        else if (!own.length) adj.push({ pts: ADJUST.guestUntried, text: 'まだ淹れたことがないので、来客には少し不安です' });
      }

      let cups = mood === 'guest' ? MOODS.guest.cups : 1;
      if (caf.late) {
        if (bean.decaf) adj.push({ pts: ADJUST.decafLate, text: `カフェインレスです（${caf.why}）` });
        else {
          adj.push({ pts: ADJUST.caffeineLate, text: `${caf.why}。少なめ（0.7杯）にします` });
          if (mood !== 'guest') cups = 0.7;
        }
      }

      const score = predicted + adj.reduce((a, x) => a + x.pts, 0);
      // 理由：予測の一文 ＋ 補正の大きい順に2つまで
      const reasons = [head, ...[...adj].sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)).slice(0, 2).map((x) => x.text)];
      const best = bestBrewOf(own);
      return {
        bean,
        score: Math.round(score * 100) / 100,
        predicted: r1(predicted),
        reasons,
        base: best ? { kind: 'brew', brewId: best.id } : { kind: 'initial' },
        cups,
        mood: m ? mood : null,
        n: own.length,
      };
    })
    .sort((a, b) => b.score - a.score || a.bean.name.localeCompare(b.bean.name, 'ja'));
  return picks.slice(0, n);
}

/** 候補で淹れる抽出の画面の URL（brew.html?...） */
export function pickHref(pick) {
  const q = new URLSearchParams();
  if (pick.base.kind === 'brew') q.set('brew', pick.base.brewId);
  else q.set('initial', pick.bean.id);
  q.set('bean', pick.bean.id);
  const adj = adjustQuery({ mood: pick.mood, cups: pick.cups });
  return `brew.html?${q.toString()}${adj ? `&${adj}` : ''}`;
}

/** 淹れ方の一言（「★5だった杯の淹れ方」「初期レシピ」） */
export function baseText(pick) {
  return pick.base.kind === 'brew' ? 'この豆でいちばん★が高かった杯の淹れ方' : 'この豆の最初のレシピ（似た豆や焙煎度から）';
}
