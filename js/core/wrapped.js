// 年間まとめ「Coffee Wrapped」（X5）：1年の杯数・産地地図・ベスト・好み・成長・提案の効果・天気と生活・
// エイジング・お金とカフェインを、全画面のカードで振り返る（純粋関数。描くのは js/wrapped-page.js）。
// 1年は暦年（1月1日〜12月31日、端末の時刻の日付で区切る。月次レポートと同じ）。今年は今日までの分（D-173）。
// データが足りないカードは出さない（spec 5.3：途中の結果を断定しない）。

import { analysisRows, ratedRows } from './analysis.js';
import { preferenceBy } from './preference.js';
import { beanJourneys, averageCupsTo90 } from './dialin-history.js';
import { reproGroups, reproScore } from './repro.js';
import { agingAll } from './aging.js';
import { lifeBy, lifeLine, lifeReadiness, seasonSummary, weatherCount } from './life.js';
import { monthlySpending } from './cost.js';
import { myCaffeineMg } from './caffeine.js';
import { pickTasting } from './tastings.js';
import { isIced } from './plan-adjust.js';
import { mean } from './chart-scale.js';
import { localYmd } from './format.js';
import { originPoint, project } from './origin-map.js';

/** 好きな豆・好みの区分に要る、★のある杯の数 */
export const FAVORITE_MIN = 3;
/** 成長（前半と後半の比べ）に要る、★のある杯の数 */
export const GROWTH_MIN = 10;
/** ホームの知らせを出す最少の杯数 */
export const NOTICE_MIN_CUPS = 10;

const r1 = (n) => Math.round(n * 10) / 10;
const alive = (r) => r && r.deletedAt == null;
const yearOfYmd = (ymd) => String(ymd ?? '').slice(0, 4);
const clean = (v) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

/** 'YYYY' として正しいか */
export function isYear(y) {
  return /^(19|20)\d\d$/.test(String(y ?? ''));
}

/** 記録のある年（新しい順）。今年は記録がなくても入れる */
export function wrappedYears(brews = [], today = localYmd()) {
  const set = new Set([yearOfYmd(today)]);
  for (const b of brews ?? []) if (alive(b) && b.at) set.add(yearOfYmd(localYmd(b.at)));
  return [...set].filter(isYear).sort().reverse();
}

/** 'YYYY-MM-DD' の日の番号（日付の差を数えるため） */
const dayNo = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

/** いちばん長く続けて淹れた日数（同じ日に何杯でも1日） */
export function longestStreak(ymds) {
  const days = [...new Set(ymds)].filter(Boolean).map(dayNo).sort((a, b) => a - b);
  let best = 0;
  let cur = 0;
  for (let i = 0; i < days.length; i += 1) {
    cur = i > 0 && days[i] - days[i - 1] === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
}

/** 期間の言葉（「1月1日〜12月31日」、今年は「1月1日〜11月18日（今日まで）」） */
export function periodText(year, today = localYmd()) {
  const end = yearOfYmd(today) === String(year) ? today : `${year}-12-31`;
  const [, m, d] = end.split('-').map(Number);
  return `1月1日〜${m}月${d}日${end === today && end !== `${year}-12-31` ? '（今日まで）' : ''}`;
}

/** 杯数のカード */
export function cupStats(rows) {
  const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, cups: 0 }));
  for (const r of rows) byMonth[Number(r.ymd.slice(5, 7)) - 1].cups += 1;
  const top = byMonth.reduce((a, b) => (b.cups > a.cups ? b : a));
  return {
    cups: rows.length,
    days: new Set(rows.map((r) => r.ymd)).size,
    streak: longestStreak(rows.map((r) => r.ymd)),
    beans: new Set(rows.map((r) => r.brew.beanId).filter(Boolean)).size,
    byMonth,
    topMonth: top.cups ? top : null,
  };
}

/**
 * 産地の地図と一覧（杯の多い順）。位置のわからない産地は一覧にだけ出す（pos が null）
 * @returns {{list:{key:string, cups:number, pos:{x:number,y:number}|null}[], countries:number, unknownCups:number}}
 */
export function originMap(rows) {
  const by = new Map();
  let unknownCups = 0;
  for (const r of rows) {
    const k = clean(r.bean?.origin?.country);
    if (!k) {
      unknownCups += 1;
      continue;
    }
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  const list = [...by.entries()]
    .map(([key, cups]) => {
      const p = originPoint(key);
      return { key, cups, pos: p ? project(p) : null };
    })
    .sort((a, b) => b.cups - a.cups || a.key.localeCompare(b.key, 'ja'));
  return { list, countries: list.length, unknownCups };
}

/** 豆の名前でまとめる鍵（同じ銘柄の別の袋を1つにする） */
const beanKey = (bean) => clean(bean?.name).toLowerCase();

/** ベストのカード：★の高い3杯と、いちばん好きだった豆（★のある杯が FAVORITE_MIN 杯以上の銘柄の平均★） */
export function bestOf(rows) {
  const rated = ratedRows(rows);
  const top = [...rated].sort((a, b) => b.stars - a.stars || String(b.at).localeCompare(String(a.at))).slice(0, 3);
  const by = new Map();
  for (const r of rated) {
    if (!r.bean) continue;
    const k = beanKey(r.bean);
    if (!k) continue;
    if (!by.has(k)) by.set(k, { name: clean(r.bean.name), roastLevel: r.bean.roastLevel ?? '', origin: clean(r.bean.origin?.country), stars: [] });
    by.get(k).stars.push(r.stars);
  }
  const fav = [...by.values()]
    .filter((g) => g.stars.length >= FAVORITE_MIN)
    .map((g) => ({ name: g.name, roastLevel: g.roastLevel, origin: g.origin, n: g.stars.length, avg: r1(mean(g.stars)) }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n)[0] ?? null;
  return {
    top: top.map((r) => ({ brewId: r.brew.id, ymd: r.ymd, stars: r.stars, beanName: clean(r.bean?.name) || '豆なし', roastLevel: r.bean?.roastLevel ?? '', ratio: r.metrics?.ratio ?? null })),
    favorite: fav,
  };
}

/** 好みのカード：焙煎度・精製・産地のそれぞれで嗜好スコアのいちばん高いもの（★のある杯が FAVORITE_MIN 杯以上の区分だけ） */
export function tasteTop(rows) {
  const out = [];
  for (const [key, label] of [['roastLevel', '焙煎度'], ['process', '精製'], ['origin', '産地']]) {
    const top = preferenceBy(rows, key).filter((p) => p.n >= FAVORITE_MIN)[0];
    if (top) out.push({ key, label, value: top.key, mean: top.mean, score: top.score, n: top.n });
  }
  return out;
}

/** 成長のカード：月ごとの平均★、前半と後半の比べ、ダイヤルインの速さ、再現性の前半と後半 */
export function growthOf(rows, recipes = []) {
  const rated = ratedRows(rows);
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const ys = rated.filter((r) => Number(r.ymd.slice(5, 7)) === m).map((r) => r.stars);
    if (ys.length) months.push({ month: m, n: ys.length, avg: r1(mean(ys)) });
  }
  let halves = null;
  if (rated.length >= GROWTH_MIN) {
    const mid = Math.floor(rated.length / 2);
    const a = rated.slice(0, mid);
    const b = rated.slice(mid);
    halves = { firstAvg: r1(mean(a.map((r) => r.stars))), secondAvg: r1(mean(b.map((r) => r.stars))), firstN: a.length, secondN: b.length };
  }
  // 再現性：杯を前半と後半に分け、両方でスコアが出るときだけ比べる
  const mid = Math.floor(rows.length / 2);
  const rA = reproScore(reproGroups(rows.slice(0, mid), recipes));
  const rB = reproScore(reproGroups(rows.slice(mid), recipes));
  const repro = rA.ready && rB.ready ? { first: rA.score, second: rB.score } : null;
  return { months, halves, cupsTo90: averageCupsTo90(beanJourneys(rows)), repro };
}

/** 成長の一文 */
export function growthLine(g) {
  if (!g.halves) return '';
  const d = r1(g.halves.secondAvg - g.halves.firstAvg);
  if (d > 0) return `年の後半は平均★が${g.halves.firstAvg}から${g.halves.secondAvg}に上がりました`;
  if (d < 0) return `年の後半は平均★が${g.halves.firstAvg}から${g.halves.secondAvg}に下がりました`;
  return `平均★は前半も後半も${g.halves.firstAvg}でした`;
}

/**
 * 提案の効果（完了条件3）：ダイヤルインの提案どおりに淹れた回（採用した提案）の、提案の前の杯とあとの杯の★。
 * あとの杯がその年のものだけ数える。前かあとの杯が消されたか、どちらかに★がない回は数えない。
 * @returns {{n:number, beforeAvg:number|null, afterAvg:number|null, up:number, same:number, down:number, pairs:object[]}}
 */
export function suggestionEffect({ suggestions = [], tastings = [], brews = [], year }) {
  const brewOf = new Map((brews ?? []).filter(alive).map((b) => [b.id, b]));
  const pairs = [];
  for (const s of suggestions ?? []) {
    if (!alive(s) || s.adopted !== true || !s.brewId || !s.nextBrewId) continue;
    const before = brewOf.get(s.brewId);
    const after = brewOf.get(s.nextBrewId);
    if (!before || !after || yearOfYmd(localYmd(after.at)) !== String(year)) continue;
    const b = pickTasting(tastings, before.id)?.stars;
    const a = pickTasting(tastings, after.id)?.stars;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    pairs.push({ suggestionId: s.id, beforeStars: b, afterStars: a, at: after.at, action: s.action?.short ?? s.action?.text ?? '' });
  }
  const n = pairs.length;
  return {
    n,
    beforeAvg: n ? r1(mean(pairs.map((p) => p.beforeStars))) : null,
    afterAvg: n ? r1(mean(pairs.map((p) => p.afterStars))) : null,
    up: pairs.filter((p) => p.afterStars > p.beforeStars).length,
    same: pairs.filter((p) => p.afterStars === p.beforeStars).length,
    down: pairs.filter((p) => p.afterStars < p.beforeStars).length,
    pairs,
  };
}

/** 提案の効果の一文 */
export function effectLine(e) {
  if (!e.n) return '';
  const d = r1(e.afterAvg - e.beforeAvg);
  const head = `提案どおりに淹れた${e.n}回で、★は平均${e.beforeAvg}から${e.afterAvg}に`;
  return d > 0 ? `${head}上がりました` : d < 0 ? `${head}下がりました` : `提案どおりに淹れた${e.n}回で、★は平均${e.beforeAvg}のままでした`;
}

/** 天気と生活のカード */
export function lifeHighlights(rows) {
  const iced = rows.filter((r) => isIced(r.brew)).length;
  const ready = lifeReadiness(rows).ready;
  const lines = [];
  if (ready) {
    for (const key of ['band', 'temp']) {
      const t = lifeLine(lifeBy(rows, key));
      if (t && !t.includes('ほとんどありません')) lines.push(`${lifeBy(rows, key).label}：${t}`);
    }
    const seasons = seasonSummary(rows).filter((s) => s.ready && s.mean != null);
    if (seasons.length >= 2) {
      const top = seasons.reduce((a, b) => (b.mean > a.mean ? b : a));
      lines.push(`季節：${top.label}の★がいちばん高め（平均${top.mean.toFixed(1)}・${top.n}杯）`);
    }
  }
  return { iced, hot: rows.length - iced, weather: weatherCount(rows), lines, ready };
}

/** エイジングのカード：飲み頃の山が出た豆の、山の真ん中の日数の平均 */
export function agingHighlight(beans, rows) {
  const peaks = agingAll(beans, rows).filter((a) => a.peak);
  if (!peaks.length) return null;
  const days = Math.round(mean(peaks.map((a) => a.peak.mid)));
  const top = peaks.reduce((a, b) => (b.peak.mean > a.peak.mean ? b : a));
  return { beans: peaks.length, days, best: { name: clean(top.bean.name), label: top.peak.label, mean: top.peak.mean } };
}

/** お金とカフェインのカード */
export function moneyOf({ beans = [], orders = [], brews = [], rows = [], year }) {
  const months = monthlySpending({ beans, orders, brews, today: `${year}-12-28`, months: 12 });
  const sum = (k) => months.reduce((a, m) => a + m[k], 0);
  const drank = sum('drankJpy');
  const costed = sum('cups') - sum('uncostedCups');
  const caf = rows.reduce((a, r) => a + (myCaffeineMg(r) ?? 0), 0);
  return {
    boughtJpy: sum('boughtJpy'),
    bags: sum('bags'),
    unpricedBags: sum('unpricedBags'),
    drankJpy: drank,
    perCupJpy: costed > 0 ? Math.round(drank / costed) : null,
    uncostedCups: sum('uncostedCups'),
    caffeineMg: Math.round(caf),
    gramsUsed: Math.round(rows.reduce((a, r) => a + (Number(r.brew.actual?.doseG) > 0 ? r.brew.actual.doseG : 0), 0)),
  };
}

/**
 * 1年のまとめのカード（出す順）。データの足りないカードは入れない。
 * @param {{brews?:object[], beans?:object[], tastings?:object[], suggestions?:object[], recipes?:object[], orders?:object[]}} data
 * @param {string} year 'YYYY'
 * @param {string} [today] 'YYYY-MM-DD'
 * @returns {{year:string, period:string, cups:number, slides:{key:string, [k:string]:any}[]}}
 */
export function wrappedSlides(data, year, today = localYmd()) {
  const y = String(year);
  const all = analysisRows(data);
  const rows = all.filter((r) => yearOfYmd(r.ymd) === y);
  const slides = [{ key: 'cover', year: y, period: periodText(y, today) }];
  if (!rows.length) return { year: y, period: periodText(y, today), cups: 0, slides };

  const cups = cupStats(rows);
  slides.push({ key: 'cups', ...cups });
  const origins = originMap(rows);
  if (origins.countries) slides.push({ key: 'origins', ...origins });
  const best = bestOf(rows);
  if (best.top.length) slides.push({ key: 'best', ...best });
  const taste = tasteTop(rows);
  if (taste.length) slides.push({ key: 'taste', items: taste });
  const growth = growthOf(rows, data.recipes ?? []);
  if (growth.months.length >= 2 || growth.halves || growth.cupsTo90 != null) slides.push({ key: 'growth', ...growth, line: growthLine(growth) });
  const effect = suggestionEffect({ ...data, year: y });
  if (effect.n) slides.push({ key: 'effect', ...effect, line: effectLine(effect) });
  const life = lifeHighlights(rows);
  if (life.iced || life.lines.length) slides.push({ key: 'life', ...life });
  const aging = agingHighlight(data.beans ?? [], rows);
  if (aging) slides.push({ key: 'aging', ...aging });
  const money = moneyOf({ ...data, rows, year: y });
  slides.push({ key: 'money', ...money });

  const rated = ratedRows(rows);
  slides.push({
    key: 'summary',
    year: y,
    cups: cups.cups,
    days: cups.days,
    beans: cups.beans,
    countries: origins.countries,
    avgStars: rated.length ? r1(mean(rated.map((r) => r.stars))) : null,
    favorite: best.favorite,
    topOrigin: origins.list[0]?.key ?? '',
    effect: effect.n ? { n: effect.n, beforeAvg: effect.beforeAvg, afterAvg: effect.afterAvg } : null,
    gramsUsed: money.gramsUsed,
  });
  return { year: y, period: periodText(y, today), cups: rows.length, slides };
}

/**
 * ホームの知らせ（12月1日〜1月31日）：12月はその年、1月は前の年のまとめ。その年に NOTICE_MIN_CUPS 杯以上あるときだけ
 * @returns {null|{year:string, key:string}}
 */
/**
 * 年を指定せずに開いたときの年。1月は前の年（ホームの知らせと同じ決め方。年が明けてすぐは振り返りたいのは前の年なので、総仕上げの72番）
 * @param {string} todayYmd
 * @param {string[]} years 選べる年（新しい順）
 */
export function defaultWrappedYear(todayYmd, years = []) {
  const y = Number(todayYmd.slice(0, 4));
  if (Number(todayYmd.slice(5, 7)) === 1 && years.includes(String(y - 1))) return String(y - 1);
  return years[0] ?? String(y);
}

export function wrappedNotice({ brews = [], now = new Date() } = {}) {
  const ymd = localYmd(now);
  const m = Number(ymd.slice(5, 7));
  if (m !== 12 && m !== 1) return null;
  const year = String(Number(ymd.slice(0, 4)) - (m === 1 ? 1 : 0));
  const cups = (brews ?? []).filter((b) => alive(b) && b.at && yearOfYmd(localYmd(b.at)) === year).length;
  return cups >= NOTICE_MIN_CUPS ? { year, key: year } : null;
}

/**
 * まとめの1枚画像（1080×1350）に載せる中身。描くのは js/wrapped-image.js
 * @param {object} s wrappedSlides の summary のカード
 * @param {string} period 期間の言葉
 */
export function wrappedImageContent(s, period = '') {
  const cut = (t, n) => ([...String(t ?? '')].length > n ? `${[...t].slice(0, n - 1).join('')}…` : String(t ?? ''));
  const stats = [
    { label: '杯数', value: `${s.cups}杯` },
    { label: '飲んだ日', value: `${s.days}日` },
    { label: '豆', value: `${s.beans}種類` },
    { label: '産地', value: `${s.countries}か国` },
    { label: '平均の★', value: s.avgStars != null ? `★${s.avgStars}` : '—' },
    { label: '使った豆', value: `${Number(s.gramsUsed ?? 0).toLocaleString('ja-JP')}g` },
  ];
  const lines = [];
  if (s.favorite) lines.push({ label: 'いちばん好きだった豆', value: cut(s.favorite.name, 20), note: `平均★${s.favorite.avg}・${s.favorite.n}杯` });
  if (s.topOrigin) lines.push({ label: 'いちばん飲んだ産地', value: cut(s.topOrigin, 20), note: '' });
  if (s.effect) lines.push({ label: '提案の効果', value: `★${s.effect.beforeAvg} → ★${s.effect.afterAvg}`, note: `提案どおりに淹れた${s.effect.n}回` });
  return { title: `${s.year}年のコーヒー`, period, stats, lines };
}
