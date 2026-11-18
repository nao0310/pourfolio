// 焙煎度比較モード（X27）：同じ豆の焙煎度違いを、同じレシピ・ブラインドで飲み比べる（純粋関数）
// 飲み比べ1回を Experiment（experiments の表）に1件で持つ（spec 9章）。
//   entries：比べる袋（焙煎度の浅い順）と、その袋で淹れた抽出
//   ratings：カップごとの評価。ブラインドのときは番号（cupNo）で評価し、答え合わせで beanId が入る
// 1人でもブラインドにできるよう、カップの底に焙煎度を書いて混ぜ、番号で評価してから底を見て答え合わせをする（D-109）。
// 答え合わせが済むと、評価をそれぞれの抽出の「温かいうち」の評価として保存する（db 側）。
// 結果を産地ごとに集め「この産地はハイが好き」を出す（spec 4.4）。
//
// 3-1 で実験（F7・B6）に広げた。種類（kind）：
//   roast     豆の飲み比べ（袋2〜4。焙煎度違いでも、銘柄違いでもよい）
//   variable  条件の飲み比べ（同じ豆・同じレシピで、挽き目・湯温・比率のどれか1つだけ変えた2杯。core/experiment-plan.js）
//   triangle  トライアングルテスト（3杯から違う1杯を当てる。core/experiment-plan.js）
//   optimize  最適化（core/optimize.js。カップはなく、ふつうに淹れて評価した杯から次の条件を出す）
// カップ（entries）は鍵（key）で区別する。同じ豆で2杯淹れることがあるため。
// 3-1 より前の記録には key がないので、読むときに key＝袋のID と読み替える（entryKey。DBは書き換えない）。

import { ROAST_LEVELS } from './roast.js';
import { STAR_MAX, QUICK_TAGS } from './tastings.js';

export const COMPARE_KIND = 'roast';
export const VARIABLE_KIND = 'variable';
export const TRIANGLE_KIND = 'triangle';
export const OPTIMIZE_KIND = 'optimize';
/** カップを淹れて飲み比べる種類（最適化は除く） */
export const CUP_KINDS = Object.freeze([COMPARE_KIND, VARIABLE_KIND, TRIANGLE_KIND]);
/** 種類の呼び方 */
export const KIND_LABELS = Object.freeze({
  [COMPARE_KIND]: '豆の飲み比べ',
  [VARIABLE_KIND]: '条件の飲み比べ',
  [TRIANGLE_KIND]: 'トライアングルテスト',
  [OPTIMIZE_KIND]: '最適化',
});
/** 種類（kind がない記録は豆の飲み比べ） */
export const kindOf = (exp) => exp?.kind ?? COMPARE_KIND;
/** カップの鍵（3-1 より前の記録は袋のID） */
export const entryKey = (e) => e?.key ?? e?.beanId ?? null;
/** 評価のカップの鍵（3-1 より前の記録は袋のID） */
const ratingKey = (r) => r?.key ?? r?.beanId ?? null;
export const MIN_ENTRIES = 2;
export const MAX_ENTRIES = 4;

const clean = (v) => String(v ?? '').normalize('NFKC').trim();
const alive = (r) => r && r.deletedAt == null;
const roastIndex = (level) => {
  const i = ROAST_LEVELS.indexOf(level);
  return i < 0 ? ROAST_LEVELS.length : i;
};

/** 焙煎度の浅い順に並べる（同じ焙煎度は名前順） */
export function sortByRoast(beans) {
  return [...(beans ?? [])].sort((a, b) => roastIndex(a.roastLevel) - roastIndex(b.roastLevel) || clean(a.name).localeCompare(clean(b.name), 'ja'));
}

/** 銘柄をまとめるときの鍵（全角・半角、空白の違いを無視） */
export function nameKey(bean) {
  return clean(bean?.name).replace(/\s+/g, '').toLowerCase();
}

/** 飲み比べに使える豆（削除・飲み切り・入荷待ちは除く） */
export function usableBeans(beans) {
  return (beans ?? []).filter((b) => alive(b) && b.status !== 'finished' && b.status !== 'ordered');
}

/**
 * 比べる組の候補：使える豆のうち、同じ銘柄で焙煎度が2つ以上あるもの（焙煎度が同じ袋は新しい1袋だけ）
 * @returns {{key:string, name:string, beans:object[]}[]}
 */
export function candidateGroups(beans) {
  const groups = new Map();
  for (const b of usableBeans(beans)) {
    if (!b.roastLevel) continue;
    const k = nameKey(b);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, new Map());
    const byLevel = groups.get(k);
    const cur = byLevel.get(b.roastLevel);
    if (!cur || String(b.roastDate ?? '') > String(cur.roastDate ?? '')) byLevel.set(b.roastLevel, b);
  }
  return [...groups.entries()]
    .filter(([, byLevel]) => byLevel.size >= MIN_ENTRIES)
    .map(([key, byLevel]) => {
      const list = sortByRoast([...byLevel.values()]).slice(0, MAX_ENTRIES);
      return { key, name: clean(list[0].name), beans: list };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/**
 * 始めるときの入力を確かめる
 * @param {{beanIds:string[], recipeId:string, blind:boolean}} input
 * @param {object[]} beans 使える豆
 */
export function normalizeCompareInput(input, beans) {
  const errors = {};
  const known = new Map(usableBeans(beans).map((b) => [b.id, b]));
  const ids = [...new Set((input?.beanIds ?? []).filter((id) => known.has(id)))];
  if (ids.length < MIN_ENTRIES || ids.length > MAX_ENTRIES) errors.beanIds = `比べる豆を${MIN_ENTRIES}〜${MAX_ENTRIES}袋選んでください`;
  const recipeId = clean(input?.recipeId);
  if (!recipeId) errors.recipeId = '淹れるレシピを選んでください';
  return { value: { beanIds: ids, recipeId: recipeId || null, blind: input?.blind !== false }, errors };
}

/** 飲み比べの名前「エチオピア 焙煎度比較」（銘柄が違う袋が混ざるときは「豆の飲み比べ（3袋）」） */
export function compareTitle(beans) {
  const names = [...new Set(beans.map((b) => clean(b.name)).filter(Boolean))];
  return names.length === 1 ? `${names[0]} 焙煎度比較` : `豆の飲み比べ（${beans.length}袋）`;
}

/**
 * 保存する飲み比べの記録の中身（id・日時の共通項目は db 側で付ける）
 * @param {{value:object, beans:object[]}} p value は normalizeCompareInput の value
 */
export function buildExperiment({ value, beans }) {
  const picked = sortByRoast(beans.filter((b) => value.beanIds.includes(b.id)));
  return {
    kind: COMPARE_KIND,
    title: compareTitle(picked),
    blind: value.blind,
    recipeId: value.recipeId,
    entries: picked.map((b) => ({ key: b.id, beanId: b.id, brewId: null })),
    ratings: [],
    revealedAt: null,
  };
}

/** 進み具合：'brewing'（まだ淹れていない袋がある）→ 'tasting'（飲み比べ・答え合わせ）→ 'done' */
export function experimentStatus(exp) {
  if (exp?.revealedAt) return 'done';
  return (exp?.entries ?? []).every((e) => e.brewId) ? 'tasting' : 'brewing';
}

export const STATUS_LABELS = Object.freeze({ brewing: '淹れている途中', tasting: '飲み比べの途中', done: '結果あり' });

/**
 * 淹れた抽出をつなぐ。カップの鍵（targetKey）が分かればそのカップ、なければ抽出の豆の袋、
 * それもなければ淹れようとした袋（targetBeanId）につなぐ。
 * 同じカップで淹れ直したら新しい抽出に置き換える。どのカップにも当たらなければ変えない
 * @returns {object} 新しい entries
 */
export function attachBrew(exp, { brewId, beanId, targetBeanId = null, targetKey = null }) {
  const entries = exp.entries ?? [];
  const hit =
    (targetKey != null ? entries.find((e) => entryKey(e) === targetKey) : null) ??
    entries.find((e) => e.beanId === beanId) ??
    entries.find((e) => e.beanId === targetBeanId);
  if (!hit) return entries;
  return entries.map((e) => (e === hit ? { ...e, brewId } : e));
}

/** カップの数（＝袋の数） */
export const cupCount = (exp) => (exp?.entries ?? []).length;

/** 1杯の評価の入力をそろえる（★1〜5・一言・メモ。どれもなくてもよい） */
export function normalizeRating(r) {
  const n = r?.stars == null || r.stars === '' ? null : Number(r.stars);
  const stars = Number.isInteger(n) && n >= 1 && n <= STAR_MAX ? n : null;
  const picked = new Set(Array.isArray(r?.tags) ? r.tags.map(clean) : []);
  return { stars, tags: QUICK_TAGS.filter((t) => picked.has(t)), memo: clean(r?.memo) };
}

/**
 * カップの評価を1件入れ替えた ratings を返す
 * ブラインドならカップの番号（cupNo）、ブラインドでなければカップの鍵（entryKey）で探す
 */
export function setRating(exp, key, rating) {
  const blind = exp.blind !== false;
  const list = [...(exp.ratings ?? [])];
  const i = list.findIndex((r) => (blind ? r.cupNo === key : ratingKey(r) === key));
  let base;
  if (blind) base = { cupNo: key, key: i >= 0 ? ratingKey(list[i]) : null, beanId: i >= 0 ? list[i].beanId ?? null : null };
  else {
    const j = (exp.entries ?? []).findIndex((e) => entryKey(e) === key);
    base = { cupNo: j + 1, key, beanId: exp.entries?.[j]?.beanId ?? null };
  }
  const next = { ...base, ...normalizeRating(rating) };
  if (i >= 0) list[i] = next;
  else list.push(next);
  return list.sort((a, b) => a.cupNo - b.cupNo);
}

/** その番号（ブラインド）か袋のカップの評価。なければ空の評価 */
export function ratingOf(exp, key) {
  const blind = exp.blind !== false;
  const r = (exp.ratings ?? []).find((x) => (blind ? x.cupNo === key : ratingKey(x) === key));
  return r ? normalizeRating(r) : { stars: null, tags: [], memo: '' };
}

/** 全部のカップに★が入っているか */
export function allRated(exp) {
  const n = cupCount(exp);
  const keys = exp.blind !== false ? Array.from({ length: n }, (_, i) => i + 1) : exp.entries.map(entryKey);
  return n > 0 && keys.every((k) => ratingOf(exp, k).stars != null);
}

/**
 * 答え合わせ：カップの番号ごとに、底に書いてあったカップ（鍵）を選ぶ。どのカップもちょうど1回ずつ選ぶ
 * @param {object} exp
 * @param {Record<number,string>} answers { 1: key, 2: key, … }（3-1 より前の記録では key＝袋のID）
 * @returns {{ratings: object[]|null, errors: Record<string,string>}}
 */
export function reveal(exp, answers) {
  const errors = {};
  const n = cupCount(exp);
  const keys = exp.entries.map(entryKey);
  const chosen = Array.from({ length: n }, (_, i) => answers?.[i + 1] ?? answers?.[String(i + 1)] ?? null);
  const what = kindOf(exp) === VARIABLE_KIND ? '条件' : '焙煎度';
  if (!allRated(exp)) errors.ratings = 'どのカップにも★を付けてください';
  if (chosen.some((k) => !keys.includes(k))) errors.answers = `どのカップも、底に書いた${what}を選んでください`;
  else if (new Set(chosen).size !== n) errors.answers = `同じ${what}を2つのカップに選んでいます`;
  if (Object.keys(errors).length) return { ratings: null, errors };
  const ratings = Array.from({ length: n }, (_, i) => {
    const entry = exp.entries.find((e) => entryKey(e) === chosen[i]);
    return { cupNo: i + 1, key: chosen[i], beanId: entry?.beanId ?? null, ...ratingOf(exp, i + 1) };
  });
  return { ratings, errors };
}

/**
 * 答え合わせのあと、抽出ごとに保存する評価 [{ brewId, beanId, value }]（淹れていない袋は除く）
 * value は normalizeTastingInput に渡せる形
 */
export function tastingsToSave(exp) {
  const out = [];
  for (const r of exp.ratings ?? []) {
    const entry = exp.entries.find((e) => entryKey(e) === ratingKey(r));
    if (!entry?.brewId) continue;
    out.push({ brewId: entry.brewId, beanId: r.beanId, value: { stars: r.stars, tags: r.tags, memo: r.memo } });
  }
  return out;
}

/**
 * 結果：カップごとの★と順位（★の多い順。同じ★は同じ順位、★なしは最後）
 * @returns {{key:string, label:string, brewId:string|null, bean:object|null, beanId:string, roastLevel:string, stars:number|null, tags:string[], memo:string, cupNo:number|null, rank:number|null}[]}
 */
export function compareResults(exp, beans) {
  const byId = new Map((beans ?? []).map((b) => [b.id, b]));
  const rows = (exp.entries ?? []).map((e) => {
    const r = (exp.ratings ?? []).find((x) => ratingKey(x) === entryKey(e));
    const bean = byId.get(e.beanId) ?? null;
    return {
      key: entryKey(e),
      label: e.label ?? '',
      brewId: e.brewId ?? null,
      bean,
      beanId: e.beanId,
      roastLevel: bean?.roastLevel ?? '',
      stars: r?.stars ?? null,
      tags: r?.tags ?? [],
      memo: r?.memo ?? '',
      cupNo: exp.blind !== false ? r?.cupNo ?? null : null,
      rank: null,
    };
  });
  rows.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1) || roastIndex(a.roastLevel) - roastIndex(b.roastLevel));
  for (const row of rows) {
    if (row.stars == null) continue;
    row.rank = rows.filter((x) => x.stars != null && x.stars > row.stars).length + 1;
  }
  return rows;
}

/** 好みを集める産地の鍵と呼び方（生産国。なければ銘柄） */
export function originOf(bean) {
  const country = clean(bean?.origin?.country);
  if (country) return { key: `c:${country.toLowerCase()}`, label: country };
  const name = clean(bean?.name);
  return name ? { key: `n:${nameKey(bean)}`, label: name } : null;
}

/**
 * 産地ごとの好きな焙煎度（結果の出た飲み比べから）
 * 焙煎度ごとに ★の平均と飲み比べた回数。いちばん★の平均が高い焙煎度を「好き」とする（同じなら1位になった回数、浅い順）
 * @returns {{key:string, label:string, experiments:number, levels:{level:string, n:number, avgStars:number, wins:number}[], best:string|null}[]}
 */
export function roastPreferences(experiments, beans) {
  const byId = new Map((beans ?? []).map((b) => [b.id, b]));
  const origins = new Map();
  for (const exp of experiments ?? []) {
    if (!alive(exp) || exp.kind !== COMPARE_KIND || experimentStatus(exp) !== 'done') continue;
    const rows = compareResults(exp, beans).filter((r) => r.stars != null && r.roastLevel && byId.has(r.beanId));
    const seen = new Set();
    for (const r of rows) {
      const o = originOf(r.bean);
      if (!o) continue;
      if (!origins.has(o.key)) origins.set(o.key, { key: o.key, label: o.label, exps: new Set(), levels: new Map() });
      const g = origins.get(o.key);
      g.exps.add(exp.id);
      if (!g.levels.has(r.roastLevel)) g.levels.set(r.roastLevel, { level: r.roastLevel, n: 0, sum: 0, wins: 0 });
      const lv = g.levels.get(r.roastLevel);
      lv.n += 1;
      lv.sum += r.stars;
      if (r.rank === 1 && !seen.has(`${o.key}|${r.roastLevel}`)) {
        lv.wins += 1;
        seen.add(`${o.key}|${r.roastLevel}`);
      }
    }
  }
  return [...origins.values()]
    .map((g) => {
      const levels = [...g.levels.values()]
        .map((l) => ({ level: l.level, n: l.n, avgStars: Math.round((l.sum / l.n) * 10) / 10, wins: l.wins }))
        .sort((a, b) => roastIndex(a.level) - roastIndex(b.level));
      const ranked = [...levels].sort((a, b) => b.avgStars - a.avgStars || b.wins - a.wins || roastIndex(a.level) - roastIndex(b.level));
      return { key: g.key, label: g.label, experiments: g.exps.size, levels, best: ranked[0]?.level ?? null };
    })
    .sort((a, b) => b.experiments - a.experiments || a.label.localeCompare(b.label, 'ja'));
}

/** その豆の産地の好み（なければ null） */
export function preferenceForBean(prefs, bean) {
  const o = originOf(bean);
  return o ? (prefs ?? []).find((p) => p.key === o.key) ?? null : null;
}

/** 好みの一言「エチオピアはハイが好き（飲み比べ2回）」 */
export function preferenceText(pref) {
  if (!pref?.best) return '';
  return `${pref.label}は${pref.best}が好き（飲み比べ${pref.experiments}回）`;
}

/** 飲み比べ・トライアングルの途中のもの（新しい順。最適化は「途中」がずっと続くので入れない） */
export function openExperiments(experiments) {
  return (experiments ?? [])
    .filter((e) => alive(e) && CUP_KINDS.includes(kindOf(e)) && experimentStatus(e) !== 'done')
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}
