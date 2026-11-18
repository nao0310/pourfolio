// 最適化モード（F7、spec 6.6）の画面
// optimize.html            始める（豆・レシピ・挽き目と比率〔と湯温〕の範囲）。?bean=ID でその豆を選んでおく
// optimize.html?id=<ID>    次の1杯・今のいちばん・予想の地図・試した杯
import {
  openDb,
  listBeans,
  listRecipes,
  listEquipment,
  listBrews,
  listTastings,
  getExperiment,
  addExperiment,
  setOptimizeDone,
  deleteExperiment,
  getLastBrew,
} from './db.js';
import { usableBeans, sortByRoast, OPTIMIZE_KIND, kindOf } from './core/compare.js';
import {
  defaultRanges,
  normalizeOptimizeInput,
  buildOptimizeExperiment,
  optimizePoints,
  nextTrial,
  bestKnown,
  trialHref,
  trialText,
  predictionTable,
  dimsOf,
  MIN_POINTS,
} from './core/optimize.js';
import { analysisRows } from './core/analysis.js';
import { DEFAULT_GRIND_STEP } from './core/dialin.js';
import { orderRecipesForList, recipeSummary } from './core/recipes.js';
import { formatDateTimeJa } from './core/format.js';
import { $, el, queryParam, showMessage, showPageLoadError, phrased, setPhrased, phraseStaticText } from './ui.js';
import { registerServiceWorker } from './pwa.js';
import { singleFlight } from './core/once.js';
import { askConfirm } from './confirm-box.js';

const db = openDb();
const enc = encodeURIComponent;
let beans = [];
let recipes = [];
let equipment = [];
let exp = null;

const beanLabel = (b) => (b ? [b.roastLevel, b.name].filter(Boolean).join('　') : '（削除した豆）');

function showErrors(errors, root) {
  for (const node of root.querySelectorAll('.field-error')) node.textContent = errors[node.dataset.for] ?? '';
}

function grindStepOf(recipe) {
  const g = equipment.find((x) => x.id === recipe?.grind?.grinderId);
  const n = Number(g?.attrs?.step);
  return n > 0 ? n : DEFAULT_GRIND_STEP;
}

// ---- 始める ----

/** レシピを選び直したら、範囲をそのレシピのまわりに入れ直す */
function fillRanges() {
  const recipe = recipes.find((r) => r.id === $('oRecipe').value);
  const step = grindStepOf(recipe);
  const r = defaultRanges(recipe, step);
  const set = (lo, hi, v) => {
    $(lo).value = v ? String(v[0]) : '';
    $(hi).value = v ? String(v[1]) : '';
  };
  set('gLo', 'gHi', r.grind);
  set('rLo', 'rHi', r.ratio);
  set('tLo', 'tHi', r.tempC);
  setPhrased($('gHint'), recipe ? `レシピは挽き目 ${recipe.grind?.setting || '（なし）'}。1目盛り ${step} で動かします（小さいほど細かい）` : '');
}

async function showStart() {
  const last = await getLastBrew(db);
  const list = usableBeans(beans).sort((a, b) => a.name.localeCompare(b.name, 'ja') || (sortByRoast([a, b])[0] === a ? -1 : 1));
  $('oBean').replaceChildren(el('option', { value: '' }, list.length ? '（選ぶ）' : '（飲める豆がありません）'), ...list.map((b) => el('option', { value: b.id }, beanLabel(b))));
  const want = queryParam('bean') ?? last?.beanId;
  if (want && list.some((b) => b.id === want)) $('oBean').value = want;
  else if (list[0]) $('oBean').value = list[0].id;
  // 挽き目が数字のレシピを先に
  const ordered = orderRecipesForList(recipes, last ? [last] : []);
  $('oRecipe').replaceChildren(el('option', { value: '' }, ordered.length ? '（選ぶ）' : '（レシピが未登録）'), ...ordered.map((r) => el('option', { value: r.id }, `${r.name}　${recipeSummary(r)}`)));
  const numeric = ordered.find((r) => Number.isFinite(Number(String(r.grind?.setting ?? '').trim())) && String(r.grind?.setting ?? '').trim() !== '');
  if (numeric ?? ordered[0]) $('oRecipe').value = (numeric ?? ordered[0]).id;
  fillRanges();
  $('startView').hidden = false;
}

const onStart = singleFlight(async () => {
  const input = {
    beanId: $('oBean').value,
    recipeId: $('oRecipe').value,
    useTemp: $('useTemp').checked,
    ranges: { grind: [$('gLo').value, $('gHi').value], ratio: [$('rLo').value, $('rHi').value], tempC: [$('tLo').value, $('tHi').value] },
  };
  const r = normalizeOptimizeInput(input, { beans, recipes, grinders: equipment.filter((e) => e.kind === 'grinder') });
  showErrors(r.errors, $('optForm'));
  if (Object.keys(r.errors).length) {
    showMessage('赤い文字のところを直してください', 'error');
    return;
  }
  $('start').disabled = true;
  try {
    const rec = await addExperiment(db, buildOptimizeExperiment(r));
    location.href = `optimize.html?id=${enc(rec.id)}`;
  } catch (err) {
    console.error(err);
    $('start').disabled = false;
    showMessage('始められませんでした。もう一度押してください', 'error');
  }
});

// ---- 最適化1つ ----

/** 予想の地図：挽き目×比率のマスに予想の★。次に試す所に印 */
function renderMap(points, next) {
  const table = predictionTable(exp, points, { tempC: next?.x?.tempC });
  $('mapCard').hidden = !table;
  if (!table) return;
  setPhrased($('mapNote'), `予想の★です（この表の中で濃いほど高い）。「次」は次に試す所、「済」は試した所${table.tempC != null ? `。湯温 ${table.tempC}℃のとき` : ''}`);
  const tried = new Set(points.map((p) => `${p.x.grind}|${p.x.ratio}`));
  // 色は表の中の低い〜高いを5段階に分ける（予想の★は近い値が並ぶので、★そのままだと同じ色になる）
  const all = table.cells.flat();
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const level = (v) => (hi - lo < 0.05 ? 3 : 1 + Math.round((4 * (v - lo)) / (hi - lo)));
  const nearest = (list, v) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const nextKey = next ? `${nearest(table.grinds, next.x.grind)}|${nearest(table.ratios, next.x.ratio)}` : '';
  $('map').replaceChildren(
    el(
      'table',
      { class: 'heatmap' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '比率＼挽き目'), ...table.grinds.map((g) => el('th', { scope: 'col' }, String(g))))),
      el(
        'tbody',
        {},
        ...table.ratios.map((ratio, i) =>
          el(
            'tr',
            {},
            el('th', { scope: 'row' }, `1:${ratio}`),
            ...table.grinds.map((grind, j) => {
              const k = `${grind}|${ratio}`;
              const mark = k === nextKey ? '次' : tried.has(k) ? '済' : '';
              return el(
                'td',
                { class: `heat lv-${level(table.cells[i][j])}${k === nextKey ? ' next' : ''}`, title: `挽き目 ${grind}・比率 1:${ratio}：予想 ★${table.cells[i][j]}` },
                el('span', { class: 'heat-score num' }, table.cells[i][j].toFixed(1)),
                mark ? el('span', { class: 'heat-n' }, mark) : '',
              );
            }),
          ),
        ),
      ),
    ),
  );
}

async function renderOpt() {
  const [brews, tastings] = await Promise.all([listBrews(db), listTastings(db)]);
  const recipe = recipes.find((r) => r.id === exp.recipeId) ?? null;
  const bean = beans.find((b) => b.id === exp.beanId) ?? null;
  const points = optimizePoints(exp, analysisRows({ brews, beans, tastings }));
  const r = exp.ranges;
  setPhrased($('title'), exp.title);
  document.title = `${exp.title} - Pourfolio`;
  setPhrased($('sub'), [
    beanLabel(bean),
    recipe ? `レシピ：${recipe.name}` : '（レシピを削除しました）',
    `挽き目 ${r.grind[0]}〜${r.grind[1]}`,
    `比率 1:${r.ratio[0]}〜1:${r.ratio[1]}`,
    r.tempC ? `湯温 ${r.tempC[0]}〜${r.tempC[1]}℃` : '',
    exp.revealedAt ? '終えた' : '',
  ]
    .filter(Boolean)
    .join('・'));

  const usable = bean && recipe && usableBeans([bean]).length > 0;
  const next = nextTrial(exp, points);
  $('nextCard').hidden = Boolean(exp.revealedAt);
  setPhrased($('nextText'), trialText(next.x));
  setPhrased($('nextReason'), usable ? next.reason : '豆を飲み切ったか、レシピを削除したので、淹れられません');
  $('nextBrew').hidden = !usable;
  if (usable) $('nextBrew').href = trialHref(exp, recipe, next.x);

  const best = bestKnown(exp, points);
  $('bestCard').hidden = !best;
  if (best) {
    setPhrased($('bestText'), `${trialText(best.x)}（${points.length >= MIN_POINTS ? `予想 ★${best.mean}、` : ''}${best.n}杯：★${best.stars.join('・★')}）`);
    $('bestBrew').hidden = !usable;
    if (usable) $('bestBrew').href = trialHref(exp, recipe, best.x);
  }

  renderMap(points, exp.revealedAt ? null : next);

  const dims = dimsOf(exp);
  const sorted = [...points].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  $('points').replaceChildren(
    ...(sorted.length
      ? sorted.map((p) =>
          el(
            'li',
            {},
            el('a', { href: `tasting.html?brew=${enc(p.brewId)}` }, `${formatDateTimeJa(p.at)}　★${p.y}`),
            el('span', { class: 'muted small' }, ' ', ...phrased(trialText(Object.fromEntries(dims.map((k) => [k, p.x[k]]))))),
          ),
        )
      : [el('li', { class: 'muted' }, 'まだ試した杯はありません。「この条件で淹れる」で淹れて★を付けると表示します')]),
  );
  $('done').textContent = exp.revealedAt ? 'この最適化を続ける' : 'この最適化を終える';
  $('optView').hidden = false;
}

async function showOpt(id) {
  exp = await getExperiment(db, id);
  if (!exp || kindOf(exp) !== OPTIMIZE_KIND) {
    $('notFound').hidden = false;
    return;
  }
  await renderOpt();
}

// ---- はじまり ----

async function init() {
  phraseStaticText(document.querySelector('main'));
  [beans, recipes, equipment] = await Promise.all([listBeans(db), listRecipes(db), listEquipment(db)]);
  beans = beans.filter((b) => b.deletedAt == null);
  const id = queryParam('id');
  if (id) await showOpt(id);
  else await showStart();
}

$('optForm').addEventListener('submit', (e) => {
  e.preventDefault();
  onStart();
});
$('oRecipe').addEventListener('change', fillRanges);
$('useTemp').addEventListener('change', () => {
  $('tBox').hidden = !$('useTemp').checked;
});
$('done').addEventListener('click', async () => {
  try {
    exp = await setOptimizeDone(db, exp.id, !exp.revealedAt);
    await renderOpt();
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error');
  }
});
$('remove').addEventListener('click', async () => {
  if (!(await askConfirm('この最適化をやめますか？淹れた抽出と評価は残ります', { ok: 'やめる', danger: true }))) return;
  await deleteExperiment(db, exp.id);
  location.replace('compare.html');
});

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showPageLoadError();
});
