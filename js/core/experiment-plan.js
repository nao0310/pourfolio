// 実験プランナー（F7）とトライアングルテスト（B6）：純粋関数
//
// 条件の飲み比べ（kind 'variable'）：同じ豆・同じレシピで、挽き目・湯温・比率のどれか1つだけを変えた2杯を淹れ、
//   ブラインドで飲み比べる（spec 6.6「1変数の飲み比べ」）。カップ a＝いつもの、b＝変えたもの。
//   変えた数字はカップの overrides に持ち、淹れる画面の URL（grind・temp・water）で計画に当てはめる。
// トライアングルテスト（kind 'triangle'）：A と B の2杯を淹れ、それぞれ2つのカップに分ける。そのうち3つ
//   （片方を2つ、もう片方を1つ）を並べ、違う1つを当てる。どちらを1つにするかはアプリが決める（oddKey）。
//   当たった回数から、偶然（3分の1）では説明しにくいかを二項検定で添える。
// 次の実験の提案：ダイヤルイン提案 → 条件と評価（E4）で関係がありそうなもの → まだ確かめていない条件、の順。

import { VARIABLE_KIND, TRIANGLE_KIND, kindOf, experimentStatus, compareResults, usableBeans } from './compare.js';
import { DEFAULT_GRIND_STEP, RATIO_STEP, pickPendingSuggestion } from './dialin.js';
import { ratioOf } from './recipes.js';

const clean = (v) => String(v ?? '').normalize('NFKC').trim();
const alive = (r) => r && r.deletedAt == null;
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = clean(v);
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
/** 刻み（0.5 や 0.1）に合わせて丸める（小数の誤差を残さない） */
const roundTo = (n, step) => {
  const d = Math.max(0, (String(step).split('.')[1] ?? '').length);
  return Number((Math.round(n / step) * step).toFixed(d));
};

/** 変えられる条件。deltas は選べる変え幅（挽き目は目盛りの数） */
export const VARIABLES = Object.freeze({
  grind: { label: '挽き目', deltas: [-2, -1, 1, 2], unit: '目盛り', up: '粗く', down: '細かく' },
  tempC: { label: '湯温', deltas: [-5, -3, 3, 5], unit: '℃', up: '上げる', down: '下げる' },
  ratio: { label: '比率', deltas: [-1, -RATIO_STEP, RATIO_STEP, 1], unit: '', up: '薄く', down: '濃く' },
});
export const VARIABLE_KEYS = Object.freeze(Object.keys(VARIABLES));
const TEMP_RANGE = [60, 100];
const RATIO_RANGE = [8, 25];

/** 変え幅の言葉「2目盛り細かく」「3℃上げる」「1薄く」 */
export function deltaText(factor, delta) {
  const v = VARIABLES[factor];
  if (!v || !delta) return '';
  const size = Math.abs(delta);
  const dir = delta > 0 ? v.up : v.down;
  if (factor === 'grind') return `${size}${v.unit}${dir}`;
  if (factor === 'tempC') return `${size}℃${dir}`;
  return `${size}${dir}`;
}

/** 計画（レシピ）の今の値。数字でなければ null */
export function baseValue(recipe, factor) {
  if (factor === 'grind') return num(recipe?.grind?.setting);
  if (factor === 'tempC') return num(recipe?.tempC);
  if (factor === 'ratio') return ratioOf(recipe?.doseG, recipe?.waterG);
  return null;
}

/** 値の言葉「挽き目 24」「湯温 92℃」「比率 1:15」 */
export function valueText(factor, value) {
  if (value == null) return '';
  if (factor === 'grind') return `挽き目 ${value}`;
  if (factor === 'tempC') return `湯温 ${value}℃`;
  if (factor === 'ratio') return `比率 1:${value}`;
  return String(value);
}

/**
 * レシピの条件を1つだけ変えた数字（淹れる画面に渡す overrides）
 * @param {object} recipe レシピ（doseG・waterG・tempC・grind.setting）
 * @param {{factor:string, delta:number, grindStep?:number}} p delta は挽き目なら目盛りの数、湯温は℃、比率は x の差
 * @returns {{ok:true, from:number, to:number, overrides:object, label:string, text:string}|{ok:false, error:string}}
 */
export function variableChange(recipe, { factor, delta, grindStep = DEFAULT_GRIND_STEP }) {
  const v = VARIABLES[factor];
  const d = Number(delta);
  if (!v) return { ok: false, error: '変える条件を選んでください' };
  if (!Number.isFinite(d) || d === 0) return { ok: false, error: '変える幅を選んでください' };
  const from = baseValue(recipe, factor);
  if (factor === 'grind') {
    if (from == null) return { ok: false, error: 'このレシピの挽き目が数字ではないので、挽き目は比べられません' };
    const step = grindStep > 0 ? grindStep : DEFAULT_GRIND_STEP;
    const to = roundTo(from + d * step, step);
    if (to < 0) return { ok: false, error: 'これ以上細かくできません' };
    return { ok: true, from, to, overrides: { grind: String(to) }, label: valueText('grind', to), text: `挽き目 ${from} → ${to}（${deltaText(factor, d)}）` };
  }
  if (factor === 'tempC') {
    if (from == null) return { ok: false, error: 'このレシピに湯温がないので、湯温は比べられません' };
    const to = Math.round(from + d);
    if (to < TEMP_RANGE[0] || to > TEMP_RANGE[1]) return { ok: false, error: `湯温は${TEMP_RANGE[0]}〜${TEMP_RANGE[1]}℃の間にしてください` };
    return { ok: true, from, to, overrides: { tempC: to }, label: valueText('tempC', to), text: `湯温 ${from}℃ → ${to}℃（${deltaText(factor, d)}）` };
  }
  // 比率：粉量はそのまま、湯量で変える
  if (from == null || !(recipe?.doseG > 0)) return { ok: false, error: 'このレシピに粉量と湯量がないので、比率は比べられません' };
  const to = roundTo(from + d, 0.1);
  if (to < RATIO_RANGE[0] || to > RATIO_RANGE[1]) return { ok: false, error: `比率は1:${RATIO_RANGE[0]}〜1:${RATIO_RANGE[1]}の間にしてください` };
  const waterG = Math.round(recipe.doseG * to);
  return {
    ok: true,
    from,
    to: ratioOf(recipe.doseG, waterG),
    overrides: { waterG },
    label: `${valueText('ratio', ratioOf(recipe.doseG, waterG))}（湯量 ${waterG}g）`,
    text: `比率 1:${from} → 1:${ratioOf(recipe.doseG, waterG)}（湯量 ${recipe.waterG}g → ${waterG}g、${deltaText(factor, d)}）`,
  };
}

/**
 * 条件の飲み比べを始める入力を確かめる
 * @param {{beanId:string, recipeId:string, factor:string, delta:number|string, blind?:boolean}} input
 * @param {{beans:object[], recipes:object[], grindStep?:number}} ctx
 */
export function normalizeVariableInput(input, { beans, recipes, grindStep = DEFAULT_GRIND_STEP }) {
  const errors = {};
  const bean = usableBeans(beans).find((b) => b.id === input?.beanId) ?? null;
  if (!bean) errors.beanId = '豆を選んでください';
  const recipe = (recipes ?? []).find((r) => alive(r) && r.id === input?.recipeId) ?? null;
  if (!recipe) errors.recipeId = '淹れるレシピを選んでください';
  const factor = VARIABLE_KEYS.includes(input?.factor) ? input.factor : null;
  const delta = Number(input?.delta);
  let change = null;
  if (!factor) errors.factor = '変える条件を選んでください';
  else if (recipe) {
    change = variableChange(recipe, { factor, delta, grindStep });
    if (!change.ok) errors.factor = change.error;
  }
  return {
    value: { beanId: bean?.id ?? null, recipeId: recipe?.id ?? null, factor, delta: Number.isFinite(delta) ? delta : null, blind: input?.blind !== false },
    errors,
    bean,
    recipe,
    change: change?.ok ? change : null,
  };
}

/**
 * 保存する条件の飲み比べ（id・日時の共通項目は db 側で付ける）
 * @param {{value:object, bean:object, recipe:object, change:object, hypothesis?:string}} p normalizeVariableInput の結果
 */
export function buildVariableExperiment({ value, bean, recipe, change, hypothesis = '' }) {
  const v = VARIABLES[value.factor];
  return {
    kind: VARIABLE_KIND,
    title: `${clean(bean.name)} ${v.label}の飲み比べ`,
    blind: value.blind,
    recipeId: recipe.id,
    beanId: bean.id,
    hypothesis: clean(hypothesis),
    variable: { factor: value.factor, delta: value.delta, from: change.from, to: change.to },
    entries: [
      { key: 'a', beanId: bean.id, brewId: null, overrides: {}, label: `いつもの（${valueText(value.factor, change.from)}）` },
      { key: 'b', beanId: bean.id, brewId: null, overrides: { ...change.overrides }, label: change.label },
    ],
    ratings: [],
    revealedAt: null,
  };
}

// ---- トライアングルテスト（B6） ----

export const TRIANGLE_CUPS = 3;
/** 偶然に当たる見込み（3つから1つ） */
export const TRIANGLE_CHANCE = 1 / 3;

/**
 * トライアングルテストを始める入力を確かめる。比べるのは「2つの豆」か「1つの豆で条件を1つ変えたもの」
 * @param {{mode:'beans'|'variable', beanIds?:string[], beanId?:string, recipeId:string, factor?:string, delta?:number}} input
 */
export function normalizeTriangleInput(input, { beans, recipes, grindStep = DEFAULT_GRIND_STEP }) {
  const mode = input?.mode === 'variable' ? 'variable' : 'beans';
  if (mode === 'variable') {
    const r = normalizeVariableInput({ ...input, blind: true }, { beans, recipes, grindStep });
    return { ...r, value: { ...r.value, mode } };
  }
  const errors = {};
  const usable = new Map(usableBeans(beans).map((b) => [b.id, b]));
  const ids = [...new Set((input?.beanIds ?? []).filter((id) => usable.has(id)))];
  if (ids.length !== 2) errors.beanIds = '比べる豆をちょうど2袋選んでください';
  const recipe = (recipes ?? []).find((r) => alive(r) && r.id === input?.recipeId) ?? null;
  if (!recipe) errors.recipeId = '淹れるレシピを選んでください';
  return { value: { mode, beanIds: ids, recipeId: recipe?.id ?? null }, errors, beans: ids.map((id) => usable.get(id)), recipe };
}

/**
 * 保存するトライアングルテスト。rand は 0〜1 の数を返す関数（テストで決め打ちにする）
 * @param {object} r normalizeTriangleInput の結果
 */
export function buildTriangleExperiment(r, rand = Math.random) {
  let entries;
  let title;
  let variable = null;
  if (r.value.mode === 'variable') {
    const v = VARIABLES[r.value.factor];
    entries = [
      { key: 'a', beanId: r.bean.id, brewId: null, overrides: {}, label: `いつもの（${valueText(r.value.factor, r.change.from)}）` },
      { key: 'b', beanId: r.bean.id, brewId: null, overrides: { ...r.change.overrides }, label: r.change.label },
    ];
    title = `${clean(r.bean.name)} ${v.label}のトライアングル`;
    variable = { factor: r.value.factor, delta: r.value.delta, from: r.change.from, to: r.change.to };
  } else {
    entries = r.beans.map((b, i) => ({ key: i === 0 ? 'a' : 'b', beanId: b.id, brewId: null, overrides: {}, label: [b.roastLevel, clean(b.name)].filter(Boolean).join('　') }));
    title = `トライアングル：${entries.map((e) => e.label).join(' と ')}`;
  }
  return {
    kind: TRIANGLE_KIND,
    title,
    blind: true,
    recipeId: r.recipe?.id ?? r.value.recipeId,
    beanId: r.value.mode === 'variable' ? r.bean.id : null,
    mode: r.value.mode,
    variable,
    entries,
    oddKey: rand() < 0.5 ? 'a' : 'b',
    answer: null,
    ratings: [],
    revealedAt: null,
  };
}

/** 2つ並べる方（oddKey でない方）のカップの鍵 */
export const pairKey = (exp) => (exp?.oddKey === 'a' ? 'b' : 'a');

/**
 * 答え合わせ：選んだ番号（違うと思ったカップ）と、底を見て分かった「1つだけのカップ」の番号
 * @param {{picked:number|string, odd:number|string, liked?:'odd'|'pair'|'same'|null}} input
 * @returns {{answer:object|null, errors:Record<string,string>}}
 */
export function judgeTriangle(input) {
  const errors = {};
  const cup = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= TRIANGLE_CUPS ? n : null;
  };
  const picked = cup(input?.picked);
  const odd = cup(input?.odd);
  if (picked == null) errors.picked = '違うと思ったカップを選んでください';
  if (odd == null) errors.odd = '底を見て、1つだけのカップを選んでください';
  if (Object.keys(errors).length) return { answer: null, errors };
  const liked = ['odd', 'pair', 'same'].includes(input?.liked) ? input.liked : null;
  return { answer: { picked, odd, correct: picked === odd, liked }, errors };
}

/** 二項分布の上側の確率 P(X ≥ k)（n 回、1回の見込み p） */
export function binomialTail(n, k, p) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0;
  let c = 1; // nCi
  for (let i = 0; i <= n; i++) {
    if (i > 0) c = (c * (n - i + 1)) / i;
    if (i >= k) sum += c * p ** i * (1 - p) ** (n - i);
  }
  return Math.min(1, sum);
}

/**
 * トライアングルテストの成績（答え合わせ済みのもの）。matchKey を渡すとその組だけ
 * @returns {{n:number, hits:number, pValue:number|null, level:'none'|'maybe'|'clear', text:string}}
 */
export function triangleStats(experiments, matchKey = null) {
  const done = (experiments ?? []).filter(
    (e) => alive(e) && kindOf(e) === TRIANGLE_KIND && e.answer && experimentStatus(e) === 'done' && (matchKey == null || triangleKey(e) === matchKey),
  );
  const n = done.length;
  const hits = done.filter((e) => e.answer.correct).length;
  if (n === 0) return { n, hits, pValue: null, level: 'none', text: '' };
  const pValue = binomialTail(n, hits, TRIANGLE_CHANCE);
  const base = `${n}回中${hits}回当たり`;
  if (pValue < 0.05) return { n, hits, pValue, level: 'clear', text: `${base}。偶然（3回に1回）ではまず説明できません。違いが分かっています` };
  if (pValue < 0.2) return { n, hits, pValue, level: 'maybe', text: `${base}。違いが分かっていそうです。回数を重ねるとはっきりします` };
  return { n, hits, pValue, level: 'none', text: `${base}。今のところ偶然と見分けられません${n < 5 ? '（5回ほど続けると分かってきます）' : ''}` };
}

/** 同じ組のトライアングルをまとめる鍵（豆2つなら豆の組、条件なら豆と条件と幅） */
export function triangleKey(exp) {
  if (exp?.mode === 'variable' && exp.variable) return `v:${exp.beanId}:${exp.variable.factor}:${exp.variable.delta}`;
  return `b:${(exp?.entries ?? []).map((e) => e.beanId).sort().join('|')}`;
}

/** 同じ組でもう1回するときの記録（カップを空にし、1つにする方を選び直す） */
export function repeatTriangle(exp, rand = Math.random) {
  return {
    kind: TRIANGLE_KIND,
    title: exp.title,
    blind: true,
    recipeId: exp.recipeId,
    beanId: exp.beanId ?? null,
    mode: exp.mode,
    variable: exp.variable ? { ...exp.variable } : null,
    entries: exp.entries.map((e) => ({ ...e, brewId: null, overrides: { ...(e.overrides ?? {}) } })),
    oddKey: rand() < 0.5 ? 'a' : 'b',
    answer: null,
    ratings: [],
    revealedAt: null,
  };
}

// ---- 条件の飲み比べの結果と、わかったこと ----

/**
 * 条件の飲み比べ1回の結果：変えた方（b）といつもの（a）の★の差
 * @returns {{factor:string, delta:number, diff:number|null, verdict:'better'|'worse'|'same'|null, text:string}|null}
 */
export function variableOutcome(exp, beans = []) {
  if (kindOf(exp) !== VARIABLE_KIND || !exp.variable || experimentStatus(exp) !== 'done') return null;
  const rows = compareResults(exp, beans);
  const a = rows.find((r) => r.key === 'a')?.stars ?? null;
  const b = rows.find((r) => r.key === 'b')?.stars ?? null;
  const { factor, delta } = exp.variable;
  const what = `${VARIABLES[factor]?.label ?? ''}を${deltaText(factor, delta)}`;
  if (a == null || b == null) return { factor, delta, diff: null, verdict: null, text: `${what}：★がそろっていません` };
  const diff = b - a;
  const verdict = diff > 0 ? 'better' : diff < 0 ? 'worse' : 'same';
  const word = verdict === 'better' ? `★${diff}つ良くなった` : verdict === 'worse' ? `★${-diff}つ下がった` : '★は同じ';
  return { factor, delta, diff, verdict, text: `${what}：${word}（★${a} → ★${b}）` };
}

/**
 * 条件の飲み比べからわかったこと（条件と向きごとにまとめる。beanId を渡すとその豆だけ）
 * @returns {{factor:string, dir:'up'|'down', label:string, n:number, better:number, worse:number, same:number, text:string}[]}
 */
export function variableFindings(experiments, beans = [], beanId = null) {
  const groups = new Map();
  for (const e of experiments ?? []) {
    if (!alive(e) || (beanId && e.beanId !== beanId)) continue;
    const o = variableOutcome(e, beans);
    if (!o || !o.verdict) continue;
    const dir = o.delta > 0 ? 'up' : 'down';
    const k = `${o.factor}:${dir}`;
    if (!groups.has(k)) groups.set(k, { factor: o.factor, dir, n: 0, better: 0, worse: 0, same: 0 });
    const g = groups.get(k);
    g.n += 1;
    g[o.verdict] += 1;
  }
  return [...groups.values()]
    .map((g) => {
      const v = VARIABLES[g.factor];
      const label = `${v.label}を${g.dir === 'up' ? v.up : v.down}`;
      const parts = [g.better ? `${g.better}回良くなった` : '', g.worse ? `${g.worse}回下がった` : '', g.same ? `${g.same}回同じ` : ''].filter(Boolean);
      return { ...g, label, text: `${label}：${g.n}回のうち${parts.join('、')}` };
    })
    .sort((a, b) => b.n - a.n || VARIABLE_KEYS.indexOf(a.factor) - VARIABLE_KEYS.indexOf(b.factor));
}

// ---- 次の実験の提案（F7） ----

/** ダイヤルイン提案の直し方を、条件と変え幅にする */
function ideaFromSuggestion(s) {
  const kind = s?.action?.kind;
  if (kind === 'finer') return { factor: 'grind', delta: -1 };
  if (kind === 'coarser') return { factor: 'grind', delta: 1 };
  if (kind === 'water') return { factor: 'ratio', delta: RATIO_STEP };
  if (kind === 'dose') return { factor: 'ratio', delta: -RATIO_STEP };
  return null;
}

/** 既定の変え幅（まだ確かめていない条件を試すとき） */
const DEFAULT_IDEAS = Object.freeze([
  { factor: 'grind', delta: -2 },
  { factor: 'tempC', delta: 3 },
  { factor: 'ratio', delta: 1 },
]);

/**
 * 次に試す飲み比べ（多くて3つ、条件が重ならないように）
 * @param {{beanId:string|null, recipe:object|null, suggestions?:object[], brews?:object[], factorResult?:object|null, experiments?:object[], grindStep?:number}} p
 *   factorResult は core/factors.js の factorAnalysis の結果（なくてもよい）
 * @returns {{factor:string, delta:number, change:object, source:'dialin'|'factors'|'untested', reason:string, href:string}[]}
 */
export function nextExperimentIdeas({ beanId, recipe, suggestions = [], brews = [], factorResult = null, experiments = [], grindStep = DEFAULT_GRIND_STEP }) {
  if (!recipe) return [];
  const out = [];
  const used = new Set();
  const tested = new Set(
    (experiments ?? [])
      .filter((e) => alive(e) && kindOf(e) === VARIABLE_KIND && e.variable && (beanId == null || e.beanId === beanId) && experimentStatus(e) === 'done')
      .map((e) => e.variable.factor),
  );
  const testedCount = (factor) =>
    (experiments ?? []).filter((e) => alive(e) && kindOf(e) === VARIABLE_KIND && e.variable?.factor === factor && experimentStatus(e) === 'done').length;
  const push = (idea, source, reason) => {
    if (!idea || used.has(idea.factor)) return;
    const change = variableChange(recipe, { ...idea, grindStep });
    if (!change.ok) return;
    used.add(idea.factor);
    const q = new URLSearchParams({ factor: idea.factor, delta: String(idea.delta), recipe: recipe.id ?? '' });
    if (beanId) q.set('bean', beanId);
    out.push({ ...idea, change, source, reason, href: `compare.html?new=variable&${q}` });
  };

  // 1. その豆で、まだ使っていないダイヤルイン提案
  const pending = pickPendingSuggestion(suggestions, beanId, brews);
  if (pending) {
    const idea = ideaFromSuggestion(pending);
    if (idea) push(idea, 'dialin', `前の1杯のダイヤルイン提案（${pending.action.short ?? pending.action.text ?? ''}）を、いつもの1杯と並べて確かめます`);
  }
  // 2. 条件と評価で関係がありそうなのに、飲み比べで2回まで確かめていない条件
  for (const f of factorResult?.factors ?? []) {
    if (!VARIABLES[f.key] || !f.fit || Math.abs(f.fit.r) < 0.3 || testedCount(f.key) >= 2) continue;
    const towardBetter = f.fit.slope > 0 ? 1 : -1; // ★が上がる向き
    const delta = f.key === 'grind' ? 2 * towardBetter : f.key === 'tempC' ? 3 * towardBetter : towardBetter;
    push(
      { factor: f.key, delta },
      'factors',
      `条件と評価で「${f.label}」と★が一緒に動いています（${f.word?.text ?? ''}）。一緒に動いているだけかもしれないので、1つだけ変えて確かめます`,
    );
  }
  // 3. まだ確かめていない条件
  for (const idea of DEFAULT_IDEAS) {
    if (tested.has(idea.factor)) continue;
    push(idea, 'untested', `この豆では、まだ${VARIABLES[idea.factor].label}を飲み比べていません`);
  }
  return out.slice(0, 3);
}
