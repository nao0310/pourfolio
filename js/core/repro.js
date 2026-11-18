// 再現性スコア（E7）：同じ豆の袋を同じレシピで淹れた杯の、★と濃さのブレ（純粋関数）
// 濃さは TDS が3杯以上ある組では TDS、ない組では評価の「濃さ」（JAR、−2〜+2）を使う（D-167）。
// ブレ（標準偏差）は3杯から、管理図（平均と±2σの線）は8杯から（spec 5.2）。
// アイスの杯と、杯数を変えた杯は湯量や濃さの意味が変わるので数えない。

import { isIced, cupsOf } from './plan-adjust.js';
import { mean } from './chart-scale.js';
import { confidenceOf } from './analysis.js';

/** ブレの数字を出す最少の杯数 */
export const REPRO_MIN = 3;
/** 管理図を出す最少の杯数（spec 5.2） */
export const REPRO_CHART = 8;

/** 言葉の境目：標準偏差がこれ未満なら「安定」、次の値未満なら「ややブレ」、それ以上は「ブレが大きい」 */
export const REPRO_LIMITS = Object.freeze({
  stars: [0.5, 1.0],
  tds: [0.05, 0.1],
  jar: [0.5, 1.0],
});

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** 標本の標準偏差（2つ未満なら null） */
export function sampleSd(xs) {
  const v = (xs ?? []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
}

/** ブレの言葉 */
export function reproWord(sd, kind) {
  if (sd == null) return { level: 'none', text: '計算できません' };
  const [a, b] = REPRO_LIMITS[kind] ?? REPRO_LIMITS.stars;
  if (sd < a) return { level: 'stable', text: '安定' };
  if (sd < b) return { level: 'some', text: 'ややブレ' };
  return { level: 'large', text: 'ブレが大きい' };
}

/**
 * 値の並びのまとめ。3つから標準偏差、8つから管理図の線と、線の外に出た番号。
 * @param {(number|null)[]} values 杯の順の値（null は数えない）
 */
export function seriesStats(values, kind) {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n < REPRO_MIN) return { n, ready: false, mean: n ? r3(mean(v)) : null, sd: null, word: reproWord(null, kind), chart: null };
  const m = mean(v);
  const sd = sampleSd(v);
  const chart =
    n >= REPRO_CHART
      ? {
          upper: r3(m + 2 * sd),
          lower: r3(m - 2 * sd),
          outside: values.map((x, i) => (Number.isFinite(x) && (x > m + 2 * sd + 1e-9 || x < m - 2 * sd - 1e-9) ? i : -1)).filter((i) => i >= 0),
        }
      : null;
  return { n, ready: true, mean: r3(m), sd: r3(sd), word: reproWord(sd, kind), chart };
}

/** 再現性に数える杯か（レシピと豆があり、アイスでなく、1杯で淹れた） */
export function reproEligible(row) {
  return Boolean(row?.brew?.recipeId && row.bean && !isIced(row.brew) && cupsOf(row.brew) === 1);
}

/**
 * 豆の袋×レシピの組ごとの再現性（3杯以上の組が先、その中で杯の多い順）。
 * @param {object[]} rows analysisRows の行（古い順）
 * @param {object[]} [recipes] レシピ（名前を出すため）
 */
export function reproGroups(rows, recipes = []) {
  const nameOf = new Map((recipes ?? []).map((r) => [r.id, r.name]));
  const groups = new Map();
  for (const r of rows ?? []) {
    if (!reproEligible(r)) continue;
    const key = `${r.bean.id}|${r.brew.recipeId}`;
    if (!groups.has(key)) groups.set(key, { key, bean: r.bean, recipeId: r.brew.recipeId, recipeName: nameOf.get(r.brew.recipeId) ?? '（削除したレシピ）', rows: [] });
    groups.get(key).rows.push(r);
  }
  const out = [...groups.values()].map((g) => {
    const list = g.rows.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const stars = list.map((r) => r.stars);
    const tds = list.map((r) => r.metrics?.tdsPct ?? null);
    const jar = list.map((r) => (Number.isFinite(r.tasting?.jar?.strength) ? r.tasting.jar.strength : null));
    const tdsN = tds.filter((x) => x != null).length;
    const strengthKind = tdsN >= REPRO_MIN ? 'tds' : 'jar';
    // レシピの版が前の杯と変わった番号（図に印を付ける）
    const versionChanges = list.map((r, i) => (i > 0 && (r.brew.recipeVersion ?? null) !== (list[i - 1].brew.recipeVersion ?? null) ? i : -1)).filter((i) => i >= 0);
    const starStats = seriesStats(stars, 'stars');
    return {
      key: g.key,
      bean: g.bean,
      recipeId: g.recipeId,
      recipeName: g.recipeName,
      cups: list.length,
      rows: list,
      lastAt: list[list.length - 1].at,
      stars: starStats,
      strength: { kind: strengthKind, values: strengthKind === 'tds' ? tds : jar, ...seriesStats(strengthKind === 'tds' ? tds : jar, strengthKind) },
      versionChanges,
      confidence: confidenceOf(starStats.n),
    };
  });
  return out.sort((a, b) => Number(b.stars.ready) - Number(a.stars.ready) || b.cups - a.cups || String(b.lastAt).localeCompare(String(a.lastAt)));
}

/**
 * 全体の再現性スコア（0〜100）。★のブレが3杯以上の組の標準偏差を、杯数で重みを付けてまとめる（合わせた分散）。
 * スコア＝100 − 50 × まとめたブレ（ブレ0で100、★1つ分で50、★2つ分で0。D-167）
 * @returns {{ready:boolean, groups:number, cups:number, sd:number|null, score:number|null, word:object}}
 */
export function reproScore(groups) {
  const ok = (groups ?? []).filter((g) => g.stars.ready);
  if (!ok.length) return { ready: false, groups: 0, cups: 0, sd: null, score: null, word: reproWord(null, 'stars') };
  let ss = 0;
  let dfs = 0;
  let cups = 0;
  for (const g of ok) {
    ss += g.stars.sd ** 2 * (g.stars.n - 1);
    dfs += g.stars.n - 1;
    cups += g.stars.n;
  }
  const sd = Math.sqrt(ss / dfs);
  return { ready: true, groups: ok.length, cups, sd: r2(sd), score: Math.round(Math.max(0, Math.min(100, 100 - 50 * sd))), word: reproWord(sd, 'stars') };
}

/** 濃さの単位つきの値 */
export function strengthText(kind, v) {
  if (v == null) return '—';
  return kind === 'tds' ? `${r2(v)}%` : `${v > 0 ? '+' : ''}${r2(v)}`;
}

/** 濃さに使った値の名前 */
export const strengthLabel = (kind) => (kind === 'tds' ? 'TDS' : '評価の濃さ');

/** 組の1行のまとめ（「★のブレ ±0.42（安定）・濃さ（TDS）のブレ ±0.04%（安定）」） */
export function reproLine(g) {
  if (!g.stars.ready && !g.strength.ready) return `あと${REPRO_MIN - g.stars.n}杯でブレを出します（★のある杯 ${g.stars.n}杯）`;
  const parts = [];
  if (g.stars.ready) parts.push(`★のブレ ±${r2(g.stars.sd)}（${g.stars.word.text}）`);
  if (g.strength.ready) parts.push(`濃さ（${strengthLabel(g.strength.kind)}）のブレ ±${r2(g.strength.sd)}${g.strength.kind === 'tds' ? '%' : '段階'}（${g.strength.word.text}）`);
  return parts.join('・');
}
