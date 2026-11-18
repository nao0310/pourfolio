// 実験の画面（X27 焙煎度比較、F7 実験プランナー、B6 ブラインド・トライアングル）
// compare.html                     一覧・次に試す実験・わかったこと・新しく始める（?bean=ID でその豆の組を選んでおく）
//   ?new=variable&factor=&delta=&recipe=&bean=   条件の飲み比べを、その中身で選んでおく（次に試す実験のボタン）
//   ?new=triangle                                トライアングルを選んでおく
// compare.html?id=<ID>             1回分：1. 淹れる → 2. 飲み比べる（ブラインドは番号で）→ 3. 答え合わせ → 結果
//   トライアングルは：1. 淹れる → 2. 当てる → 3. 答え合わせ → 結果（当たり・成績）
// 最適化（F7）は optimize.html（ここには一覧だけ出す）
import {
  openDb,
  listBeans,
  listRecipes,
  listExperiments,
  listBrews,
  listTastings,
  listSuggestions,
  listEquipment,
  getExperiment,
  addExperiment,
  updateExperiment,
  finishExperiment,
  finishTriangle,
  deleteExperiment,
  getLastBrew,
} from './db.js';
import {
  candidateGroups,
  usableBeans,
  sortByRoast,
  normalizeCompareInput,
  buildExperiment,
  experimentStatus,
  STATUS_LABELS,
  KIND_LABELS,
  COMPARE_KIND,
  VARIABLE_KIND,
  TRIANGLE_KIND,
  OPTIMIZE_KIND,
  CUP_KINDS,
  kindOf,
  entryKey,
  cupCount,
  setRating,
  ratingOf,
  allRated,
  reveal,
  compareResults,
  roastPreferences,
  preferenceForBean,
  preferenceText,
  openExperiments,
  MAX_ENTRIES,
} from './core/compare.js';
import {
  VARIABLES,
  VARIABLE_KEYS,
  deltaText,
  variableChange,
  normalizeVariableInput,
  buildVariableExperiment,
  normalizeTriangleInput,
  buildTriangleExperiment,
  judgeTriangle,
  pairKey,
  triangleStats,
  triangleKey,
  repeatTriangle,
  variableOutcome,
  variableFindings,
  nextExperimentIdeas,
  TRIANGLE_CUPS,
} from './core/experiment-plan.js';
import { analysisRows } from './core/analysis.js';
import { factorAnalysis } from './core/factors.js';
import { adjustQuery } from './core/plan-adjust.js';
import { DEFAULT_GRIND_STEP } from './core/dialin.js';
import { orderRecipesForList, recipeSummary } from './core/recipes.js';
import { tastingSummary } from './core/tastings.js';
import { renderStars, renderTags } from './tasting-parts.js';
import { $, el, queryParam, showMessage, showPageLoadError, phrased, setPhrased, phraseStaticText } from './ui.js';
import { registerServiceWorker } from './pwa.js';
import { singleFlight, serialQueue } from './core/once.js';
import { askConfirm } from './confirm-box.js';

const db = openDb();
const enc = encodeURIComponent;
let beans = [];
let recipes = [];
let equipment = [];
let exp = null;

const beanLabel = (b) => (b ? [b.roastLevel, b.name].filter(Boolean).join('　') : '（削除した豆）');
const beanOf = (id) => beans.find((b) => b.id === id) ?? null;
const recipeOf = (id) => recipes.find((r) => r.id === id) ?? null;
const letter = (key) => (key === 'a' ? 'A' : key === 'b' ? 'B' : '');
/** カップの呼び方（豆の飲み比べは袋、ほかは記録した名前。トライアングルは A・B を付ける） */
function cupLabel(e) {
  if (kindOf(exp) === COMPARE_KIND) return beanLabel(beanOf(e.beanId));
  const label = e.label || beanLabel(beanOf(e.beanId));
  return kindOf(exp) === TRIANGLE_KIND ? `${letter(entryKey(e))}：${label}` : label;
}
/** そのレシピのグラインダーの1目盛り */
function grindStepOf(recipe) {
  const g = equipment.find((x) => x.id === recipe?.grind?.grinderId);
  const n = Number(g?.attrs?.step);
  return n > 0 ? n : DEFAULT_GRIND_STEP;
}

function showErrors(errors, root) {
  for (const node of root.querySelectorAll('.field-error')) node.textContent = errors[node.dataset.for] ?? '';
}

/** 押して1つを選ぶボタンの並び */
function segButtons(box, options, current, onPick) {
  box.replaceChildren(
    ...options.map((o) =>
      el('button', { type: 'button', class: 'seg', 'aria-pressed': String(o.value === current), onclick: () => onPick(o.value) }, o.label),
    ),
  );
}

// ---- 一覧と、新しく始める ----

function expLink(e) {
  const status = experimentStatus(e);
  const kind = kindOf(e);
  const detail =
    kind === TRIANGLE_KIND
      ? e.answer
        ? e.answer.correct
          ? '当たり'
          : 'はずれ'
        : STATUS_LABELS[status]
      : `${STATUS_LABELS[status]}・${kind === COMPARE_KIND ? `${e.entries.length}袋` : '2杯'}${e.blind !== false ? '・ブラインド' : ''}`;
  return el('li', {}, el('a', { href: `compare.html?id=${enc(e.id)}` }, ...phrased(e.title || KIND_LABELS[kind])), el('span', { class: 'muted small' }, ' ', ...phrased(`${KIND_LABELS[kind]}・${detail}`)));
}

function checkBeans(ids, box = '#beanChecks') {
  for (const input of document.querySelectorAll(`${box} input`)) input.checked = ids.includes(input.value);
}

/** 新しく始める：選んでいる種類 */
let startKind = COMPARE_KIND;
function setStartKind(kind) {
  startKind = kind;
  segButtons(
    $('kindSeg'),
    // 幅320でも1行に収まる短い名前にする（下の説明の文で何をするかを書く）
    [
      { value: COMPARE_KIND, label: '豆' },
      { value: VARIABLE_KIND, label: '条件' },
      { value: TRIANGLE_KIND, label: 'トライアングル' },
    ],
    kind,
    setStartKind,
  );
  $('startForm').hidden = kind !== COMPARE_KIND;
  $('varForm').hidden = kind !== VARIABLE_KIND;
  $('triForm').hidden = kind !== TRIANGLE_KIND;
}

/** 条件と幅を選ぶ欄（条件の飲み比べと、トライアングルの「条件を変える」で使う） */
function factorPicker({ factorBox, deltaSel, preview, beanSel, recipeSel, initial = {} }) {
  let factor = VARIABLE_KEYS.includes(initial.factor) ? initial.factor : 'grind';
  const defaults = { grind: -1, tempC: 3, ratio: 0.5 };
  const fillDelta = (want) => {
    const list = VARIABLES[factor].deltas;
    deltaSel.replaceChildren(...list.map((d) => el('option', { value: String(d) }, deltaText(factor, d))));
    deltaSel.value = String(list.includes(Number(want)) ? Number(want) : defaults[factor]);
  };
  const showPreview = () => {
    const recipe = recipeOf(recipeSel.value);
    if (!recipe) {
      preview.textContent = '';
      return;
    }
    const c = variableChange(recipe, { factor, delta: Number(deltaSel.value), grindStep: grindStepOf(recipe) });
    setPhrased(preview, c.ok ? `いつもの1杯と、${c.short}（${c.detail}）を比べます` : c.error);
  };
  const pick = (f, want) => {
    factor = f;
    segButtons(factorBox, VARIABLE_KEYS.map((k) => ({ value: k, label: VARIABLES[k].label })), factor, (k) => pick(k));
    fillDelta(want);
    showPreview();
  };
  deltaSel.addEventListener('change', showPreview);
  recipeSel.addEventListener('change', showPreview);
  beanSel?.addEventListener('change', showPreview);
  pick(factor, initial.delta);
  return { get factor() { return factor; }, get delta() { return Number(deltaSel.value); } };
}

/** 豆の選び肢（使える豆。銘柄の順、同じ銘柄は焙煎度の浅い順） */
function usableSorted() {
  return usableBeans(beans).sort((a, b) => a.name.localeCompare(b.name, 'ja') || (sortByRoast([a, b])[0] === a ? -1 : 1));
}
function fillBeanSelect(sel, want) {
  const list = usableSorted();
  sel.replaceChildren(el('option', { value: '' }, list.length ? '（選ぶ）' : '（飲める豆がありません）'), ...list.map((b) => el('option', { value: b.id }, beanLabel(b))));
  if (want && list.some((b) => b.id === want)) sel.value = want;
  else if (list[0]) sel.value = list[0].id;
}
function fillRecipeSelect(sel, ordered, want) {
  sel.replaceChildren(el('option', { value: '' }, ordered.length ? '（選ぶ）' : '（レシピが未登録）'), ...ordered.map((r) => el('option', { value: r.id }, `${r.name}　${recipeSummary(r)}`)));
  if (want && ordered.some((r) => r.id === want)) sel.value = want;
  else if (ordered[0]) sel.value = ordered[0].id;
}
function beanChecks(box) {
  const list = usableSorted();
  box.replaceChildren(
    ...(list.length
      ? list.map((b) => el('label', { class: 'check-row' }, el('input', { type: 'checkbox', value: b.id }), el('span', {}, beanLabel(b))))
      : [el('p', { class: 'muted' }, '飲める豆がありません。先に豆を登録してください')]),
  );
}

let varPicker = null;
let triPicker = null;
let triMode = 'beans';
function setTriMode(mode) {
  triMode = mode;
  segButtons($('tMode'), [{ value: 'beans', label: '2つの豆' }, { value: 'variable', label: '条件を1つ変える' }], mode, setTriMode);
  $('tBeansBox').hidden = mode !== 'beans';
  $('tVarBox').hidden = mode !== 'variable';
}

/** わかったこと：好きな焙煎度・条件の飲み比べ・トライアングルの成績 */
function renderFindings(experiments) {
  const items = [];
  for (const p of roastPreferences(experiments, beans)) {
    items.push(el('li', {}, el('strong', {}, ...phrased(preferenceText(p))), el('span', { class: 'muted small' }, ...phrased(p.levels.map((l) => `${l.level} ★${l.avgStars}（${l.n}杯）`).join('・')))));
  }
  for (const f of variableFindings(experiments, beans)) {
    items.push(el('li', {}, el('strong', {}, ...phrased(f.text)), el('span', { class: 'muted small' }, '条件の飲み比べ（全部の豆）')));
  }
  const seen = new Set();
  const tris = experiments
    .filter((e) => kindOf(e) === TRIANGLE_KIND && e.answer)
    .sort((a, b) => String(b.revealedAt).localeCompare(String(a.revealedAt)));
  for (const e of tris) {
    const k = triangleKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push(el('li', {}, el('strong', {}, ...phrased(e.title)), el('span', { class: 'muted small' }, ...phrased(triangleStats(experiments, k).text))));
  }
  $('findCard').hidden = items.length === 0;
  $('findList').replaceChildren(...items);
}

/** 次に試す実験（F7）：直近に淹れた豆（?bean= があればその豆）とそのレシピで */
function renderIdeas({ brews, tastings, suggestions, experiments, last }) {
  const want = queryParam('bean');
  const bean = beanOf(want) ?? beanOf(last?.beanId);
  if (!bean || !usableBeans([bean]).length) {
    $('ideasCard').hidden = true;
    return;
  }
  const beanBrews = brews.filter((b) => b.beanId === bean.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const recipe = recipeOf(beanBrews[0]?.recipeId) ?? recipeOf(last?.recipeId) ?? orderRecipesForList(recipes, last ? [last] : [])[0] ?? null;
  let factorResult = null;
  try {
    factorResult = factorAnalysis(analysisRows({ brews, beans, tastings }));
  } catch (err) {
    console.error(err); // 条件と評価が計算できなくても、ほかの案は出す
  }
  const ideas = nextExperimentIdeas({ beanId: bean.id, recipe, suggestions, brews, factorResult, experiments, grindStep: grindStepOf(recipe) });
  $('ideasCard').hidden = ideas.length === 0;
  setPhrased($('ideasFor'), recipe ? `${beanLabel(bean)}・${recipe.name}で` : '');
  $('ideas').replaceChildren(
    ...ideas.map((i) =>
      el(
        'li',
        {},
        el('strong', {}, ...phrased(i.change.short)),
        el('span', { class: 'muted small' }, ...phrased(i.change.detail)),
        el('span', { class: 'small' }, ...phrased(i.reason)),
        el('div', { class: 'row' }, el('a', { class: 'btn small', href: i.href }, 'この飲み比べを始める')),
      ),
    ),
  );
}

async function showList() {
  const [experiments, last, brews, tastings, suggestions] = await Promise.all([listExperiments(db), getLastBrew(db), listBrews(db), listTastings(db), listSuggestions(db)]);
  $('listView').hidden = false;

  const open = openExperiments(experiments);
  $('openList').replaceChildren(
    ...open.map((e) =>
      el(
        'div',
        { class: 'card resume-card' },
        el('p', {}, el('strong', {}, ...phrased(`${STATUS_LABELS[experimentStatus(e)]}：${e.title}`))),
        el('div', { class: 'row' }, el('a', { class: 'btn', href: `compare.html?id=${enc(e.id)}` }, '続きに戻る')),
      ),
    ),
  );

  renderIdeas({ brews, tastings, suggestions, experiments, last });
  renderFindings(experiments);

  const opts = experiments.filter((e) => kindOf(e) === OPTIMIZE_KIND).sort((a, b) => Boolean(a.revealedAt) - Boolean(b.revealedAt) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  $('optList').replaceChildren(
    ...opts.map((e) => el('li', {}, el('a', { href: `optimize.html?id=${enc(e.id)}` }, e.title), el('span', { class: 'muted small' }, e.revealedAt ? '　終えた' : '　続けている'))),
  );
  const optBean = queryParam('bean');
  if (optBean) $('optStart').href = `optimize.html?bean=${enc(optBean)}`;

  const done = experiments
    .filter((e) => CUP_KINDS.includes(kindOf(e)) && experimentStatus(e) === 'done')
    .sort((a, b) => String(b.revealedAt).localeCompare(String(a.revealedAt)));
  $('doneCard').hidden = done.length === 0;
  $('doneList').replaceChildren(...done.map(expLink));

  // 始める：豆の飲み比べ（候補の組・豆・レシピ）
  const groups = candidateGroups(beans);
  $('groups').replaceChildren(
    groups.length
      ? el(
          'div',
          { class: 'compare-groups' },
          el('p', { class: 'muted small' }, '焙煎度違いがそろっている豆'),
          ...groups.map((g) =>
            el('button', { type: 'button', class: 'btn secondary small', onclick: () => checkBeans(g.beans.map((b) => b.id)) }, `${g.name}（${g.beans.map((b) => b.roastLevel).join('・')}）`),
          ),
        )
      : el('p', { class: 'muted small' }, '同じ銘柄で焙煎度が違う袋を登録すると、ここに組が出ます'),
  );
  beanChecks($('beanChecks'));
  beanChecks($('tBeanChecks'));
  const ordered = orderRecipesForList(recipes, last ? [last] : []);
  const wantRecipe = queryParam('recipe');
  fillRecipeSelect($('recipe'), ordered, wantRecipe);
  fillRecipeSelect($('vRecipe'), ordered, wantRecipe);
  fillRecipeSelect($('tRecipe'), ordered, wantRecipe);
  const wantBean = queryParam('bean') ?? last?.beanId ?? null;
  fillBeanSelect($('vBean'), wantBean);
  fillBeanSelect($('tBean'), wantBean);
  varPicker = factorPicker({ factorBox: $('vFactor'), deltaSel: $('vDelta'), preview: $('vPreview'), beanSel: $('vBean'), recipeSel: $('vRecipe'), initial: { factor: queryParam('factor'), delta: queryParam('delta') } });
  triPicker = factorPicker({ factorBox: $('tFactor'), deltaSel: $('tDelta'), preview: $('tPreview'), beanSel: $('tBean'), recipeSel: $('tRecipe') });
  setTriMode('beans');

  // ?bean=ID：その豆の組を選んでおく（なければその豆だけ）
  const want = queryParam('bean');
  if (want) {
    const g = groups.find((x) => x.beans.some((b) => b.id === want));
    checkBeans(g ? g.beans.map((b) => b.id) : [want]);
  }
  const wantKind = queryParam('new');
  setStartKind([VARIABLE_KIND, TRIANGLE_KIND].includes(wantKind) ? wantKind : COMPARE_KIND);
  if (wantKind) $('startCard').scrollIntoView({ block: 'start' });
}

/** 保存して開く（連打で2件できないように、2-8 の12番） */
async function startWith(button, record, msgId = 'msg') {
  button.disabled = true;
  try {
    const rec = await addExperiment(db, record);
    location.href = `compare.html?id=${enc(rec.id)}`;
  } catch (err) {
    console.error(err);
    button.disabled = false;
    showMessage('始められませんでした。もう一度押してください', 'error', msgId);
  }
}

const onStart = singleFlight(async () => {
  const beanIds = [...document.querySelectorAll('#beanChecks input:checked')].map((i) => i.value);
  const { value, errors } = normalizeCompareInput({ beanIds, recipeId: $('recipe').value, blind: $('blind').checked }, beans);
  showErrors(errors, $('startForm'));
  if (Object.keys(errors).length) {
    showMessage(beanIds.length > MAX_ENTRIES ? `比べられるのは${MAX_ENTRIES}袋までです` : '赤い文字のところを直してください', 'error', 'msg');
    return;
  }
  await startWith($('start'), buildExperiment({ value, beans }));
});

const onVarStart = singleFlight(async () => {
  const recipe = recipeOf($('vRecipe').value);
  const r = normalizeVariableInput(
    { beanId: $('vBean').value, recipeId: $('vRecipe').value, factor: varPicker.factor, delta: varPicker.delta, blind: $('vBlind').checked },
    { beans, recipes, grindStep: grindStepOf(recipe) },
  );
  showErrors(r.errors, $('varForm'));
  if (Object.keys(r.errors).length) {
    showMessage('赤い文字のところを直してください', 'error', 'vMsg');
    return;
  }
  await startWith($('vStart'), buildVariableExperiment({ ...r, hypothesis: $('vHypo').value }), 'vMsg');
});

const onTriStart = singleFlight(async () => {
  const recipe = recipeOf($('tRecipe').value);
  const input =
    triMode === 'variable'
      ? { mode: 'variable', beanId: $('tBean').value, recipeId: $('tRecipe').value, factor: triPicker.factor, delta: triPicker.delta }
      : { mode: 'beans', beanIds: [...document.querySelectorAll('#tBeanChecks input:checked')].map((i) => i.value), recipeId: $('tRecipe').value };
  const r = normalizeTriangleInput(input, { beans, recipes, grindStep: grindStepOf(recipe) });
  showErrors(r.errors, $('triForm'));
  if (Object.keys(r.errors).length) {
    showMessage('赤い文字のところを直してください', 'error', 'tMsg');
    return;
  }
  await startWith($('tStart'), buildTriangleExperiment(r), 'tMsg');
});

// ---- 1回分 ----

/** そのカップを淹れる画面の URL（変えた条件は URL にも入れる。淹れる画面は記録の条件を正にする） */
function brewHref(e) {
  const extra = adjustQuery({ overrides: e.overrides ?? {} });
  return `brew.html?recipe=${enc(exp.recipeId ?? '')}&bean=${enc(e.beanId)}&compare=${enc(exp.id)}&cup=${enc(entryKey(e))}${extra ? `&${extra}` : ''}`;
}

/** 1. 淹れる */
function renderEntries() {
  const blind = exp.blind !== false;
  const kind = kindOf(exp);
  setPhrased(
    $('brewHint'),
    kind === TRIANGLE_KIND
      ? 'AとBを1杯ずつ淹れ、2つのカップに分けます。カップの底に、AかBを書いた付せんを貼ります'
      : !blind
        ? '1杯ずつ「淹れる」で淹れます'
        : `1杯ずつ淹れて、カップの底に${kind === VARIABLE_KIND ? '条件' : '焙煎度'}を書いた付せんを貼ります`,
  );
  const status = experimentStatus(exp);
  $('entries').replaceChildren(
    ...exp.entries.map((e) => {
      const href = brewHref(e);
      return el(
        'li',
        {},
        el('span', { class: 'compare-bean' }, ...phrased(cupLabel(e))),
        e.brewId
          ? el('span', { class: 'compare-done' }, '淹れた', status !== 'done' ? el('a', { class: 'small', href }, '淹れ直す') : '')
          : el('a', { class: 'btn small', href }, '淹れる'),
      );
    }),
  );
}

/** メモの保存待ち（カップごと）。打ち終わって0.5秒で保存する。結果を出す前には待たずに保存する（2-8 の11番） */
const memoWaits = new Map();
/** 評価の保存は1つずつ順番に（古い中身から作った保存が、新しい保存を上書きしないように） */
const ratingQueue = serialQueue();

/** カップ1つの評価を保存する（入力のたびに） */
function saveRating(key, rating) {
  return ratingQueue
    .run(async () => {
      exp = await updateExperiment(db, exp.id, { ratings: setRating(exp, key, rating) });
      showErrors({}, $('revealCard'));
    })
    .catch((err) => {
      console.error(err);
      showMessage('★やメモを保存できませんでした。もう一度入れてください', 'error', 'rMsg');
    });
}

/** 保存待ちのメモを今すぐ保存し、全部の保存が終わるのを待つ */
async function flushRatings() {
  for (const [key, w] of memoWaits) {
    clearTimeout(w.timer);
    memoWaits.delete(key);
    w.run();
  }
  await ratingQueue.idle();
}

/** 2. 飲み比べる：ブラインドなら番号、そうでなければカップごとに★・一言・メモ */
function renderCups() {
  const blind = exp.blind !== false;
  setPhrased(
    $('tasteHint'),
    blind ? `底を見ずに混ぜて、左から1〜${cupCount(exp)}番にします。番号ごとに★を付けます（一言・メモはなくてもよい）` : 'カップごとに★を付けます（一言・メモはなくてもよい）',
  );
  const keys = blind ? exp.entries.map((_, i) => i + 1) : exp.entries.map(entryKey);
  $('cups').replaceChildren(
    ...keys.map((key) => {
      const state = ratingOf(exp, key);
      const save = () => saveRating(key, state);
      const stars = el('div', { class: 'stars', role: 'group', 'aria-label': '★' });
      const tags = el('div', { class: 'chips' });
      renderStars(stars, state, save);
      renderTags(tags, state, save);
      const memo = el('textarea', {
        rows: '1',
        'aria-label': 'メモ',
        placeholder: 'メモ',
        oninput: (ev) => {
          state.memo = ev.target.value;
          clearTimeout(memoWaits.get(key)?.timer);
          memoWaits.set(key, { run: save, timer: setTimeout(() => (memoWaits.delete(key), save()), 500) });
        },
      });
      memo.value = state.memo;
      const title = blind ? `カップ ${key}` : cupLabel(exp.entries.find((e) => entryKey(e) === key));
      return el('div', { class: 'cup-block' }, el('h3', {}, ...phrased(title)), stars, tags, memo);
    }),
  );
}

/** 3. 答え合わせ（ブラインド）／結果を見る（ブラインドでない） */
function renderReveal() {
  const blind = exp.blind !== false;
  const what = kindOf(exp) === VARIABLE_KIND ? '条件' : '焙煎度';
  $('revealTitle').textContent = blind ? '3. 答え合わせ' : '3. 結果を見る';
  $('reveal').textContent = blind ? '答え合わせをする' : '結果を見る'; // 見出しとボタンの言葉をそろえる（2-8の25番）
  setPhrased($('revealHint'), blind ? `全部に★を付けたら、底を見て、番号ごとに${what}を選びます` : '全部に★を付けたら押します');
  $('answers').replaceChildren(
    ...(blind
      ? exp.entries.map((_, i) =>
          el(
            'label',
            { class: 'field answer-row' },
            el('span', { class: 'label' }, `カップ ${i + 1}`),
            el(
              'select',
              { 'data-cup': String(i + 1) },
              el('option', { value: '' }, `（底に書いた${what}）`),
              ...exp.entries.map((e) => el('option', { value: entryKey(e) }, cupLabel(e))),
            ),
          ),
        )
      : []),
  );
}

async function onReveal() {
  await flushRatings(); // 打ったばかりのメモも結果に入れる
  const blind = exp.blind !== false;
  let ratings;
  if (blind) {
    const answers = Object.fromEntries([...document.querySelectorAll('#answers select')].map((s) => [s.dataset.cup, s.value || null]));
    const r = reveal(exp, answers);
    showErrors(r.errors, $('revealCard'));
    if (!r.ratings) {
      showMessage('赤い文字のところを直してください', 'error', 'rMsg');
      return;
    }
    ratings = r.ratings;
  } else {
    if (!allRated(exp)) {
      showErrors({ ratings: 'どのカップにも★を付けてください' }, $('revealCard'));
      return;
    }
    ratings = exp.ratings;
  }
  $('reveal').disabled = true;
  try {
    exp = await finishExperiment(db, exp.id, ratings);
    await renderExp();
    $('resultCard').scrollIntoView({ block: 'start' });
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error', 'rMsg');
  } finally {
    $('reveal').disabled = false;
  }
}

// ---- トライアングル ----

const triState = { picked: null, odd: null, liked: null };
function renderTriangle() {
  // 長い1段落をやめ、3行の手順にする（3-1.1）
  const pairL = letter(pairKey(exp));
  const oddL = letter(exp.oddKey);
  $('triHint').replaceChildren(
    el('li', {}, ...phrased(`${pairL}を2つ、${oddL}を1つ並べます（残りの${oddL}はあとで）`)),
    el('li', {}, ...phrased(`底を見ずに混ぜて、左から1〜${TRIANGLE_CUPS}番にします`)),
    el('li', {}, ...phrased('3つとも飲んで、違う1つを選びます')),
  );
  $('triOddLabel').textContent = `底を見て、${oddL}だったカップ`;
  const cups = Array.from({ length: TRIANGLE_CUPS }, (_, i) => ({ value: i + 1, label: `カップ${i + 1}` }));
  const draw = () => {
    segButtons($('triPicked'), cups, triState.picked, (v) => ((triState.picked = v), draw()));
    segButtons($('triOdd'), cups, triState.odd, (v) => ((triState.odd = v), draw()));
    segButtons($('triLiked'), [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'same', label: '同じくらい' }], triState.liked, (v) => ((triState.liked = triState.liked === v ? null : v), draw()));
  };
  draw();
}

const onTriReveal = singleFlight(async () => {
  const { answer, errors } = judgeTriangle(triState);
  showErrors(errors, $('triCard'));
  if (!answer) {
    showMessage('赤い文字のところを直してください', 'error', 'triMsg');
    return;
  }
  $('triReveal').disabled = true;
  try {
    exp = await finishTriangle(db, exp.id, answer);
    await renderExp();
    $('resultCard').scrollIntoView({ block: 'start' });
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error', 'triMsg');
  } finally {
    $('triReveal').disabled = false;
  }
});

const onAgain = singleFlight(async () => {
  await startWith($('again'), repeatTriangle(exp), 'triMsg');
});

/** 結果 */
async function renderResults() {
  const kind = kindOf(exp);
  const all = await listExperiments(db);
  $('againRow').hidden = kind !== TRIANGLE_KIND;
  if (kind === TRIANGLE_KIND) {
    const a = exp.answer ?? {};
    const likedText = a.liked === 'same' ? '好みは同じくらい' : a.liked ? `${letter(a.liked)}の方が好き` : '';
    $('outcome').hidden = false;
    setPhrased($('outcome'), a.correct ? `当たり！違うカップ（カップ${a.odd}）を当てました` : `はずれ。違ったのはカップ${a.odd}（選んだのはカップ${a.picked}）`);
    $('results').replaceChildren(
      ...exp.entries.map((e) =>
        el(
          'li',
          {},
          el('span', { class: 'num compare-rank' }, letter(entryKey(e))),
          el(
            'span',
            { class: 'compare-result-body' },
            e.brewId ? el('a', { href: `tasting.html?brew=${enc(e.brewId)}` }, ...phrased(e.label)) : el('span', {}, ...phrased(e.label)),
            el('span', { class: 'muted small' }, entryKey(e) === exp.oddKey ? '1つだけのカップ' : '2つのカップ'),
          ),
        ),
      ),
    );
    setPhrased($('prefText'), [triangleStats(all, triangleKey(exp)).text, likedText].filter(Boolean).join('。'));
    $('resultNote').textContent = '淹れた杯は、名前を押すと評価できます';
    return;
  }
  const rows = compareResults(exp, beans);
  const tastings = (await db.table('tastings').toArray()).filter((t) => t.deletedAt == null && t.experimentId === exp.id);
  const outcome = variableOutcome(exp, beans);
  $('outcome').hidden = !outcome;
  setPhrased($('outcome'), outcome?.text ?? '');
  $('results').replaceChildren(
    ...rows.map((r) => {
      const t = tastings.find((x) => x.brewId === r.brewId && (x.stage ?? 'warm') === 'warm');
      const entry = exp.entries.find((e) => entryKey(e) === r.key);
      return el(
        'li',
        {},
        el('span', { class: 'num compare-rank' }, r.rank != null ? `${r.rank}位` : '—'),
        el(
          'span',
          { class: 'compare-result-body' },
          r.brewId ? el('a', { href: `tasting.html?brew=${enc(r.brewId)}` }, ...phrased(cupLabel(entry))) : el('span', {}, ...phrased(cupLabel(entry))),
          el('span', { class: 'muted small' }, [r.cupNo != null ? `カップ${r.cupNo}` : '', tastingSummary(t ?? r)].filter(Boolean).join('　')),
        ),
      );
    }),
  );
  if (kind === VARIABLE_KIND) {
    const f = variableFindings(all, beans, exp.beanId).find((x) => x.factor === exp.variable?.factor && x.dir === (exp.variable?.delta > 0 ? 'up' : 'down'));
    setPhrased($('prefText'), f && f.n > 1 ? `この豆で${f.text}` : '');
  } else {
    const first = rows[0]?.bean;
    setPhrased($('prefText'), first ? preferenceText(preferenceForBean(roastPreferences(all, beans), first)) : '');
  }
}

async function renderExp() {
  const status = experimentStatus(exp);
  const kind = kindOf(exp);
  setPhrased($('title'), exp.title || KIND_LABELS[kind]);
  document.title = `${exp.title || KIND_LABELS[kind]} - Pourfolio`;
  const recipe = exp.recipeId ? await db.table('recipes').get(exp.recipeId) : null;
  setPhrased($('sub'), [KIND_LABELS[kind], recipe ? `レシピ：${recipe.name}` : '', kind !== TRIANGLE_KIND && exp.blind !== false ? 'ブラインド' : '', STATUS_LABELS[status]].filter(Boolean).join('・'));
  $('hypo').hidden = !exp.hypothesis;
  setPhrased($('hypo'), exp.hypothesis ? `予想：${exp.hypothesis}` : '');
  renderEntries();
  const tri = kind === TRIANGLE_KIND;
  $('tasteCard').hidden = tri || status !== 'tasting';
  $('revealCard').hidden = tri || status !== 'tasting';
  $('triCard').hidden = !tri || status !== 'tasting';
  $('resultCard').hidden = status !== 'done';
  if (status === 'tasting') {
    if (tri) renderTriangle();
    else {
      renderCups();
      renderReveal();
    }
  }
  if (status === 'done') await renderResults();
  $('expView').hidden = false;
}

async function showExp(id) {
  exp = await getExperiment(db, id);
  if (exp && kindOf(exp) === OPTIMIZE_KIND) {
    location.replace(`optimize.html?id=${enc(id)}`);
    return;
  }
  if (!exp) {
    $('notFound').hidden = false;
    return;
  }
  $('crumb').textContent = '実験';
  $('crumb').href = 'compare.html';
  await renderExp();
  if (queryParam('brewed') === '1') {
    const next = exp.entries.find((e) => !e.brewId);
    // 次に淹れるカップが見えるように
    (next ? $('brewCard') : kindOf(exp) === TRIANGLE_KIND ? $('triCard') : $('tasteCard')).scrollIntoView({ block: 'start' });
  }
}

// ---- はじまり ----

async function init() {
  phraseStaticText(document.querySelector('main'));
  [beans, recipes, equipment] = await Promise.all([listBeans(db), listRecipes(db), listEquipment(db)]);
  beans = beans.filter((b) => b.deletedAt == null);
  const id = queryParam('id');
  if (id) await showExp(id);
  else await showList();
}

for (const [form, run] of [['startForm', onStart], ['varForm', onVarStart], ['triForm', onTriStart]]) {
  $(form).addEventListener('submit', (e) => {
    e.preventDefault(); // 処理中の2回目でも、ブラウザの送信は止める
    run();
  });
}
$('reveal').addEventListener('click', onReveal);
$('triReveal').addEventListener('click', onTriReveal);
$('again').addEventListener('click', onAgain);
$('remove').addEventListener('click', async () => {
  if (!(await askConfirm('この実験をやめますか？淹れた抽出と評価は残ります', { ok: 'やめる', danger: true }))) return;
  await deleteExperiment(db, exp.id);
  location.replace('compare.html');
});

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showPageLoadError(); // エラーの文の欄は隠れた箱の中にあるため、見える所に出す（2-8 の15番）
});
