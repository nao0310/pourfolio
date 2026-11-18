// 生活との関係（E6）と季節の好みの変化（X20）（純粋関数）
// 時間帯・曜日・気分・気温・湿度・天気・季節・ホットとアイスで杯を分け、区分ごとの★を嗜好スコア（ベイズ平均、spec 5.1）で比べる。
// 一緒に動いているだけで原因とは限らない（spec 5.3）。区分の杯が少ないうちは棒を出さない。

import { ratedRows, readiness } from './analysis.js';
import { bayesScore } from './preference.js';
import { mean } from './chart-scale.js';
import { BANDS, bandOf } from './usual.js';
import { MOODS, isIced } from './plan-adjust.js';
import { ROAST_GROUPS, roastGroup } from './roast.js';
import { brewWeather, weatherGroup, WEATHER_GROUPS } from './weather.js';

/** 区分の棒を出す最少の杯数 */
export const MIN_GROUP = 3;
/** 季節ごとのまとめを出す最少の杯数（★あり） */
export const MIN_SEASON = 5;

const r2 = (n) => Math.round(n * 100) / 100;

/** 季節（D-165：春3〜5月・夏6〜8月・秋9〜11月・冬12〜2月） */
export const SEASONS = Object.freeze([
  { key: 'spring', label: '春', months: [3, 4, 5] },
  { key: 'summer', label: '夏', months: [6, 7, 8] },
  { key: 'autumn', label: '秋', months: [9, 10, 11] },
  { key: 'winter', label: '冬', months: [12, 1, 2] },
]);

/** 日時の季節 */
export function seasonOf(date) {
  const m = new Date(date).getMonth() + 1;
  return SEASONS.find((s) => s.months.includes(m));
}

/** 朝5時区切りの曜日（0=日）。夜中の2時は前の日の夜として数える（ホームの「今日」と同じ） */
export function dayOf(date) {
  return new Date(new Date(date).getTime() - 5 * 3600 * 1000).getDay();
}

const TEMP_BANDS = [
  { key: 't0', label: '10℃未満', to: 10 },
  { key: 't1', label: '10〜20℃', to: 20 },
  { key: 't2', label: '20〜28℃', to: 28 },
  { key: 't3', label: '28℃以上', to: Infinity },
];
const HUM_BANDS = [
  { key: 'h0', label: '40%未満', to: 40 },
  { key: 'h1', label: '40〜70%', to: 70 },
  { key: 'h2', label: '70%以上', to: Infinity },
];
const band = (list, v) => (v == null ? null : list.find((b) => v < b.to)?.key ?? null);

/**
 * 分け方の一覧。groups は表示の順、of(row) は区分のキー（分けられない杯は null）
 * needsWeather：天気が付いた杯でだけ分けられる
 */
export const LIFE_DIMENSIONS = Object.freeze([
  { key: 'band', label: '時間帯', groups: BANDS.map((b) => ({ key: b.key, label: `${b.label}（${b.from}〜${b.to % 24}時）` })), of: (r) => bandOf(r.at)?.key ?? null },
  {
    key: 'week',
    label: '曜日',
    groups: [
      { key: 'weekday', label: '平日（月〜金）' },
      { key: 'weekend', label: '週末（土日）' },
    ],
    of: (r) => {
      const d = dayOf(r.at);
      return d === 0 || d === 6 ? 'weekend' : 'weekday';
    },
  },
  {
    key: 'mood',
    label: '気分',
    groups: [...Object.entries(MOODS).map(([key, m]) => ({ key, label: m.label })), { key: 'none', label: '選ばなかった' }],
    of: (r) => (MOODS[r.brew?.context?.mood] ? r.brew.context.mood : 'none'),
  },
  {
    key: 'iced',
    label: 'ホットとアイス',
    groups: [
      { key: 'hot', label: 'ホット' },
      { key: 'iced', label: 'アイス（急冷）' },
    ],
    of: (r) => (isIced(r.brew) ? 'iced' : 'hot'),
  },
  { key: 'temp', label: '気温', needsWeather: true, groups: TEMP_BANDS, of: (r) => band(TEMP_BANDS, brewWeather(r.brew)?.tempC ?? null) },
  { key: 'humidity', label: '湿度', needsWeather: true, groups: HUM_BANDS, of: (r) => band(HUM_BANDS, brewWeather(r.brew)?.humidity ?? null) },
  {
    key: 'weather',
    label: '天気',
    needsWeather: true,
    groups: Object.entries(WEATHER_GROUPS).map(([key, g]) => ({ key, label: g.label })),
    of: (r) => weatherGroup(brewWeather(r.brew)?.code),
  },
  { key: 'season', label: '季節', groups: SEASONS.map((s) => ({ key: s.key, label: s.label })), of: (r) => seasonOf(r.at)?.key ?? null },
]);

/**
 * ある分け方での区分ごとの★
 * @returns {{key:string, label:string, needsWeather:boolean, shown:{key:string,label:string,n:number,mean:number,score:number}[], few:{label:string,n:number}[], counted:number}}
 */
export function lifeBy(rows, dimKey) {
  const dim = LIFE_DIMENSIONS.find((d) => d.key === dimKey);
  if (!dim) throw new Error(`知らない分け方です：${dimKey}`);
  const rated = ratedRows(rows);
  const all = mean(rated.map((r) => r.stars));
  const by = new Map();
  for (const r of rated) {
    const k = dim.of(r);
    if (k == null) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r.stars);
  }
  const shown = [];
  const few = [];
  let counted = 0;
  for (const g of dim.groups) {
    const ys = by.get(g.key) ?? [];
    counted += ys.length;
    if (!ys.length) continue;
    if (ys.length < MIN_GROUP) {
      few.push({ label: g.label, n: ys.length });
      continue;
    }
    const m = mean(ys);
    shown.push({ key: g.key, label: g.label, n: ys.length, mean: r2(m), score: r2(bayesScore(ys.length, m, all)) });
  }
  return { key: dim.key, label: dim.label, needsWeather: !!dim.needsWeather, shown, few, counted };
}

/**
 * 区分の比べを1行にする（「朝がいちばん高め（スコア3.9）」）。比べられる区分が2つ以上で、差が0.2以上のときだけ
 */
export function lifeLine(res) {
  if (res.shown.length < 2) return '';
  const sorted = [...res.shown].sort((a, b) => b.score - a.score);
  const [top, next] = sorted;
  const low = sorted[sorted.length - 1];
  if (top.score - low.score < 0.2) return `${res.label}による★の差は、ほとんどありません`;
  return `${top.label}がいちばん高め（スコア${top.score.toFixed(2)}、次は${next.label}の${next.score.toFixed(2)}）`;
}

/**
 * 時間帯ごとによく選んだ焙煎度（★がなくても数える）
 * @returns {{key:string, label:string, n:number, group:string|null, groupLabel:string, share:number}[]}
 */
export function roastByBand(rows) {
  return BANDS.map((b) => {
    const list = rows.filter((r) => bandOf(r.at)?.key === b.key);
    const counts = new Map();
    for (const r of list) {
      const g = roastGroup(r.bean?.roastLevel);
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const order = Object.keys(ROAST_GROUPS);
    const best = [...counts.entries()].sort((x, y) => y[1] - x[1] || order.indexOf(x[0]) - order.indexOf(y[0]))[0];
    const known = [...counts.values()].reduce((a, c) => a + c, 0);
    return {
      key: b.key,
      label: b.label,
      n: list.length,
      group: best ? best[0] : null,
      groupLabel: best ? ROAST_GROUPS[best[0]].label : '',
      share: best && known ? Math.round((best[1] / known) * 100) : 0,
    };
  });
}

/** 焙煎度の区分ごとの★で、いちばん高いもの（2杯以上の区分から） */
function bestRoast(rated) {
  const by = new Map();
  for (const r of rated) {
    const g = roastGroup(r.bean?.roastLevel);
    if (!g) continue;
    if (!by.has(g)) by.set(g, []);
    by.get(g).push(r.stars);
  }
  const list = [...by.entries()].filter(([, ys]) => ys.length >= 2).map(([g, ys]) => ({ group: g, label: ROAST_GROUPS[g].label, n: ys.length, mean: r2(mean(ys)) }));
  list.sort((a, b) => b.mean - a.mean || b.n - a.n);
  return list[0] ?? null;
}

function hotIced(rated) {
  const hot = rated.filter((r) => !isIced(r.brew)).map((r) => r.stars);
  const iced = rated.filter((r) => isIced(r.brew)).map((r) => r.stars);
  return { hot: { n: hot.length, mean: hot.length ? r2(mean(hot)) : null }, iced: { n: iced.length, mean: iced.length ? r2(mean(iced)) : null } };
}

/**
 * 季節ごとのまとめ（X20）：★の平均、★のいちばん高い焙煎度、ホットとアイス
 * @returns {{key:string, label:string, n:number, mean:number|null, ready:boolean, best:object|null, hotIced:object}[]}
 */
export function seasonSummary(rows) {
  const rated = ratedRows(rows);
  return SEASONS.map((s) => {
    const list = rated.filter((r) => seasonOf(r.at)?.key === s.key);
    return {
      key: s.key,
      label: s.label,
      n: list.length,
      mean: list.length ? r2(mean(list.map((r) => r.stars))) : null,
      ready: list.length >= MIN_SEASON,
      best: list.length >= MIN_SEASON ? bestRoast(list) : null,
      hotIced: hotIced(list),
    };
  });
}

/** 季節の1行（「中深煎りが★4.2でいちばん。アイスが★4.0、ホットが★3.6」） */
export function seasonLine(s) {
  if (!s.ready) return `★のある杯が${MIN_SEASON}杯たまると出します（いま${s.n}杯）`;
  const parts = [];
  parts.push(s.best ? `${s.best.label}が★${s.best.mean.toFixed(1)}でいちばん（${s.best.n}杯）` : `★の平均${s.mean.toFixed(1)}`);
  const { hot, iced } = s.hotIced;
  if (iced.n >= 2 && hot.n >= 2) parts.push(`アイスが★${iced.mean.toFixed(1)}、ホットが★${hot.mean.toFixed(1)}`);
  return parts.join('。');
}

/**
 * 季節の変わり目の見直し（X20）：3・6・9・12月の1〜15日に、去年の同じ季節の★のある杯が MIN_SEASON 杯以上あれば出す
 * @returns {null|{key:string, season:string, label:string, n:number, text:string}}
 */
export function seasonReview({ rows = [], now = new Date() } = {}) {
  const d = new Date(now);
  const month = d.getMonth() + 1;
  if (![3, 6, 9, 12].includes(month) || d.getDate() > 15) return null;
  const s = seasonOf(d);
  const from = new Date(d.getFullYear() - 1, month - 1, 1);
  const to = new Date(d.getFullYear() - 1, month + 2, 1);
  const list = ratedRows(rows).filter((r) => {
    const t = Date.parse(r.at);
    return t >= from.getTime() && t < to.getTime();
  });
  if (list.length < MIN_SEASON) return null;
  const best = bestRoast(list);
  const { hot, iced } = hotIced(list);
  const parts = [`去年の${s.label}は${list.length}杯淹れました`];
  if (best) parts.push(`${best.label}の★が高めでした（★${best.mean.toFixed(1)}・${best.n}杯）`);
  if (iced.n >= 2 && hot.n >= 2 && iced.mean > hot.mean) parts.push(`アイスの★がホットより高めでした`);
  return { key: `${d.getFullYear()}-${s.key}`, season: s.key, label: s.label, n: list.length, text: `${parts.join('。')}。` };
}

/** 生活との関係の画面を出せるか（★のある杯が30杯） */
export const LIFE_NEED = 30;
export function lifeReadiness(rows) {
  return readiness(ratedRows(rows).length, LIFE_NEED);
}

/** 天気が付いた杯の数 */
export const weatherCount = (rows) => rows.filter((r) => brewWeather(r.brew)).length;
