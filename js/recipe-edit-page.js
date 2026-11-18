// レシピの作成・編集（4:6メソッドと基本形の雛形つき）
import { openDb, addRecipe, updateRecipe, deleteRecipe, getRecipe, listEquipment, getSettings } from './db.js';
import { groupEquipmentByKind, defaultEquipmentIds } from './core/equipment.js';
import {
  TEMPLATE_KINDS,
  TASTES_46,
  STRENGTHS_46,
  POUR_STYLES,
  DEFAULT_RATIO,
  DEFAULT_FLOW_GPS,
  fillPourSecs,
  flowOf,
  newRecipeState,
  recipeToState,
  normalizeRecipeInput,
  applyTemplate,
  scalePoursToWater,
  ratioOf,
  waterFromRatio,
  parseSec,
  formatSec,
  templateLabel,
} from './core/recipes.js';
import { parseNumber } from './core/beans.js';
import { doseFromSettings } from './core/inventory.js';
import { $, el, queryParam, showMessage, stepperField } from './ui.js';
import { registerServiceWorker } from './pwa.js';
import { askConfirm } from './confirm-box.js';

const db = openDb();
const form = $('form');
const editId = queryParam('id');

let state; // recipeToState / newRecipeState の形
let ratio = DEFAULT_RATIO;
let nameTouched = false; // 名前を自分で入れたら、雛形に合わせた自動の名前をやめる
let grinders = [];

const valid = (n, lo, hi) => typeof n === 'number' && !Number.isNaN(n) && n >= lo && n <= hi;
const toNum = (v) => (typeof v === 'number' ? v : parseNumber(v));

// ---- 分量の入力欄（±ボタン付き） ----
const dose = stepperField({ id: 'doseG', label: '粉量', unit: 'g', step: 0.5, decimals: 1, min: 1, max: 100, errorFor: 'doseG', onValue: onDose });
const ratioF = stepperField({ id: 'ratio', label: '比率（湯量÷粉量）', unit: '倍', step: 0.5, decimals: 1, min: 5, max: 30, onValue: onRatio });
const water = stepperField({ id: 'waterG', label: '湯量', unit: 'g', step: 5, decimals: 1, min: 10, max: 3000, errorFor: 'waterG', onValue: onWater });
const temp = stepperField({ id: 'tempC', label: '湯温', unit: '℃', step: 1, decimals: 1, min: 50, max: 100, errorFor: 'tempC', onValue: (n) => (state.tempC = n) });
const grind = stepperField({
  id: 'grindSetting',
  label: '挽き目（目盛り）',
  step: 1,
  decimals: 2,
  min: -1000,
  max: 1000,
  hint: '数字の目盛りなら±で動かせます。文字でも入れられます',
  onValue: (_n, raw) => (state.grindSetting = raw),
});
const flow = stepperField({
  id: 'flowGps',
  label: '目安の流速',
  unit: 'g/秒',
  step: 0.5,
  decimals: 1,
  min: 0.5,
  max: 100,
  hint: '注ぐ量÷流速で、各投の注ぐ秒数を計算します（秒数を手で直した投はそのまま）',
  onValue: onFlow,
});
$('flowField').append(flow.node);
$('doseField').append(dose.node);
$('ratioField').append(ratioF.node);
$('waterField').append(water.node);
$('tempField').append(temp.node);
$('grindField').append(grind.node);

/** 分量の欄に今の値を入れる（入力中の欄はそのまま） */
function syncNumbers() {
  dose.set(state.doseG);
  ratioF.set(ratio);
  water.set(state.waterG);
  temp.set(state.tempC);
  flow.set(state.flowGps);
  if (document.activeElement !== $('targetTotalSec')) $('targetTotalSec').value = formatSec(state.targetTotalSec);
}

const flowNow = () => (valid(state.flowGps, 0.5, 100) ? state.flowGps : DEFAULT_FLOW_GPS);

/** 注湯を作り直したあと、手で直した注ぐ秒数を同じ投に戻し、ほかは流速から計算し直す */
function refillSecs(pours, old = state.pours) {
  const kept = pours.map((p, i) =>
    old[i]?.pourSecManual && typeof old[i].pourSec === 'number' ? { ...p, pourSec: old[i].pourSec, pourSecManual: true } : { ...p, pourSecManual: false },
  );
  return fillPourSecs(kept, flowNow());
}

/** 雛形があれば作り直す。なければ注湯を湯量に合わせて比例で直す */
function rebuild({ keepWater = false } = {}) {
  if (state.template) {
    state.template.ratio = ratio;
    const made = applyTemplate(state.template, state.doseG, flowNow());
    if (made) {
      const targetWater = keepWater ? state.waterG : made.waterG;
      state.waterG = targetWater;
      state.pours = refillSecs(keepWater ? scalePoursToWater(made.pours, targetWater) : made.pours);
      state.targetTotalSec = made.targetTotalSec;
    }
  } else if (valid(state.waterG, 10, 3000) && state.pours.length && state.pours.every((p) => toNum(p.toG) > 0)) {
    state.pours = refillSecs(
      scalePoursToWater(
        state.pours.map((p) => ({ ...p, toG: toNum(p.toG) })),
        state.waterG,
      ),
    );
  }
  renderPours();
  syncNumbers();
}

function onFlow(n) {
  if (!valid(n, 0.5, 100)) return;
  state.flowGps = n;
  recalcAutoSecs();
}

/** 手で直していない投の注ぐ秒数を計算し直し、欄に入れる（入力中の欄は作り直さない） */
function recalcAutoSecs() {
  const numeric = state.pours.map((p) => ({ ...p, toG: toNum(p.toG), atSec: typeof p.atSec === 'number' ? p.atSec : parseSec(p.atSec) }));
  const filled = fillPourSecs(numeric, flowNow());
  state.pours.forEach((p, i) => {
    if (!p.pourSecManual) p.pourSec = filled[i].pourSec ?? '';
    secFields[i]?.set(p.pourSec);
  });
  updateFlows();
}

function onDose(n) {
  if (!valid(n, 0.1, 100)) return;
  state.doseG = n;
  state.waterG = waterFromRatio(n, ratio);
  rebuild();
}
function onRatio(n) {
  if (!valid(n, 1, 50)) return;
  ratio = n;
  if (valid(state.doseG, 0.1, 100)) state.waterG = waterFromRatio(state.doseG, n);
  rebuild();
}
function onWater(n) {
  if (!valid(n, 10, 3000)) return;
  state.waterG = n;
  if (valid(state.doseG, 0.1, 100)) ratio = ratioOf(state.doseG, n);
  rebuild({ keepWater: true });
}

// ---- 雛形 ----
const chipGroup = (box, name, dict, onPick) =>
  box.replaceChildren(
    ...Object.entries(dict).map(([value, label]) =>
      el('label', { class: 'chip' }, el('input', { type: 'radio', name, value, onchange: () => onPick(value) }), el('span', {}, label)),
    ),
  );
const checkRadio = (name, value) => {
  for (const r of form.querySelectorAll(`input[name="${name}"]`)) r.checked = r.value === String(value);
};

chipGroup($('templateChips'), 'template', { ...TEMPLATE_KINDS, basic: '基本形', none: '自分で' }, (v) => {
  if (v === 'none') state.template = null;
  else if (v === '46') state.template = { kind: '46', ratio, taste: 'standard', strength: 'standard' };
  else state.template = { kind: 'basic', ratio, pourCount: 3 };
  if (state.template) rebuild();
  syncTemplate();
});
chipGroup($('tasteChips'), 'taste', TASTES_46, (v) => {
  state.template.taste = v;
  rebuild();
  syncTemplate();
});
chipGroup($('strengthChips'), 'strength', STRENGTHS_46, (v) => {
  state.template.strength = v;
  rebuild();
  syncTemplate();
});
chipGroup($('pourCountChips'), 'pourCount', { 2: '2回', 3: '3回' }, (v) => {
  state.template.pourCount = Number(v);
  rebuild();
  syncTemplate();
});

const TEMPLATE_NOTES = {
  46: '甘め＝1投目を少なめ、明るめ＝1投目を多め。濃いめ＝後半を細かく分けます。45秒ごとに注ぎます',
  basic: '粉量の2倍のお湯で蒸らし、残りを等分して注ぎます',
  none: '注湯を自由に決めます。雛形を選ぶと注湯を作り直します',
};

/** 雛形の選択と、名前の自動入力を今の状態に合わせる */
function syncTemplate() {
  const t = state.template;
  checkRadio('template', t ? t.kind : 'none');
  $('tasteField').hidden = t?.kind !== '46';
  $('strengthField').hidden = t?.kind !== '46';
  $('pourCountField').hidden = t?.kind !== 'basic';
  if (t?.kind === '46') {
    checkRadio('taste', t.taste);
    checkRadio('strength', t.strength);
  }
  if (t?.kind === 'basic') checkRadio('pourCount', t.pourCount);
  $('templateNote').textContent = TEMPLATE_NOTES[t ? t.kind : 'none'];
  // 新しいレシピで名前を打っていなければ、雛形の名前を入れる（「自分で」にしても消さない）
  if (!nameTouched && !editId && t) $('name').value = templateLabel(t);
}

$('name').addEventListener('input', () => (nameTouched = true));

// ---- 注湯の表 ----
let secFields = []; // 各投の「注ぐ秒数」の欄

function pourRow(p, i, prevToG) {
  const toG = toNum(p.toG);
  const amount = toG > 0 && prevToG != null ? Math.round((toG - prevToG) * 10) / 10 : null;
  const onEdit = () => {
    if (state.template) {
      state.template = null;
      syncTemplate();
      $('templateNote').textContent = '注湯を手で直したので、雛形との連動を外しました';
    }
    updatePourChecks();
  };
  const timeInput = el('input', {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    'aria-label': `${i + 1}投目の時間`,
    value: typeof p.atSec === 'number' ? formatSec(p.atSec) : String(p.atSec ?? ''),
    oninput: (e) => {
      const s = parseSec(e.target.value);
      state.pours[i].atSec = s == null || Number.isNaN(s) ? e.target.value : s;
      onEdit();
    },
  });
  const gInput = el('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    'aria-label': `${i + 1}投目の累計湯量`,
    value: p.toG == null ? '' : String(p.toG),
    oninput: (e) => {
      const n = parseNumber(e.target.value);
      state.pours[i].toG = n == null || Number.isNaN(n) ? e.target.value : n;
      onEdit();
    },
  });
  const style = el(
    'select',
    {
      'aria-label': `${i + 1}投目の注ぎ方`,
      onchange: (e) => {
        state.pours[i].style = e.target.value;
      },
    },
    el('option', { value: '' }, '注ぎ方'),
    ...Object.entries(POUR_STYLES).map(([v, label]) => el('option', { value: v, selected: p.style === v }, label)),
  );
  const secField = stepperField({
    id: `pourSec${i}`,
    label: '注ぐ秒数',
    unit: '秒',
    step: 1,
    min: 1,
    max: 600,
    onValue: (n, raw) => {
      state.pours[i].pourSec = n == null || Number.isNaN(n) ? raw : n;
      state.pours[i].pourSecManual = true;
      updateFlows();
    },
  });
  secField.set(p.pourSec);
  secFields[i] = secField;
  return el(
    'div',
    { class: 'pour-row' },
    el('div', { class: 'pour-head' }, el('span', { class: 'pour-no' }, i === 0 ? '1投目（蒸らし）' : `${i + 1}投目`), el('span', { class: 'muted amount', data: { i } }, amount != null ? `${amount}g注ぐ` : '')),
    el(
      'div',
      { class: 'pour-inputs' },
      el('label', { class: 'mini' }, el('span', {}, '時間'), timeInput),
      el('label', { class: 'mini' }, el('span', {}, '累計(g)'), gInput),
      el('label', { class: 'mini' }, el('span', {}, '注ぎ方'), style),
      state.pours.length > 1 &&
        el(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `${i + 1}投目を消す`,
            onclick: () => {
              state.pours.splice(i, 1);
              onEdit();
              renderPours();
            },
          },
          '×',
        ),
    ),
    el('div', { class: 'pour-sec' }, secField.node, el('span', { class: 'muted flow num', data: { i } })),
  );
}

function renderPours() {
  secFields = [];
  let prev = 0;
  const rows = state.pours.map((p, i) => {
    const row = pourRow(p, i, prev);
    const g = toNum(p.toG);
    prev = g > 0 ? g : null;
    return row;
  });
  $('pours').replaceChildren(...rows);
  updatePourChecks();
}

/** 1投ごとの注ぐ量と、最後の累計が湯量と合っているかを表示し直す（入力欄は作り直さない） */
function updatePourChecks() {
  let prev = 0;
  state.pours.forEach((p, i) => {
    const g = toNum(p.toG);
    const box = $('pours').querySelector(`.amount[data-i="${i}"]`);
    if (box) box.textContent = g > 0 && prev != null ? `${Math.round((g - prev) * 10) / 10}g注ぐ` : '';
    prev = g > 0 ? g : null;
  });
  recalcAutoSecs();
  const last = toNum(state.pours.at(-1)?.toG);
  $('fitPours').hidden = !(last > 0 && valid(state.waterG, 10, 3000) && Math.abs(last - state.waterG) > 0.5);
}

/** 各投の流速を表示し直す */
function updateFlows() {
  let prev = 0;
  state.pours.forEach((p, i) => {
    const g = toNum(p.toG);
    const box = $('pours').querySelector(`.flow[data-i="${i}"]`);
    const f = g > 0 && prev != null ? flowOf(g - prev, toNum(p.pourSec)) : null;
    if (box) box.textContent = f != null ? `流速 ${f}g/秒${p.pourSecManual ? '' : '（自動）'}` : '';
    prev = g > 0 ? g : null;
  });
}

$('addPour').addEventListener('click', () => {
  const last = state.pours.at(-1);
  const at = typeof last?.atSec === 'number' ? last.atSec + 30 : '';
  state.pours.push({ atSec: at, toG: '', style: last?.style ?? '', pourSec: '', pourSecManual: false });
  if (state.template) {
    state.template = null;
    syncTemplate();
  }
  renderPours();
  $('pours').querySelectorAll('.pour-row').item(state.pours.length - 1)?.querySelectorAll('input')[1]?.focus();
});

$('fitPours').addEventListener('click', () => {
  state.pours = refillSecs(
    scalePoursToWater(
      state.pours.map((p) => ({ ...p, toG: toNum(p.toG) })),
      state.waterG,
    ),
  );
  renderPours();
});

// ---- 器具の選択 ----
function fillSelect(select, items, selectedId) {
  select.replaceChildren(
    el('option', { value: '' }, items.length ? '（選ばない）' : '（未登録）'),
    ...items.map((e) => el('option', { value: e.id, selected: e.id === selectedId }, e.name)),
  );
  // 削除された器具が選ばれていたら「選ばない」にする
  if (selectedId && !items.some((e) => e.id === selectedId)) select.value = '';
}

function syncGrindStep() {
  const g = grinders.find((x) => x.id === $('grinderId').value);
  grind.setStep(g?.attrs?.step > 0 ? g.attrs.step : 1);
}

for (const k of ['grinderId', 'dripperId', 'filterId', 'kettleId']) {
  $(k).addEventListener('change', (e) => {
    state[k] = e.target.value;
    if (k === 'grinderId') syncGrindStep();
  });
}
$('targetTotalSec').addEventListener('input', (e) => (state.targetTotalSec = e.target.value));
$('bloomStir').addEventListener('change', (e) => (state.bloomStir = e.target.checked));
$('favorite').addEventListener('change', (e) => (state.favorite = e.target.checked));
$('memo').addEventListener('input', (e) => (state.memo = e.target.value));

// ---- 保存 ----
function showErrors(errors) {
  for (const box of form.querySelectorAll('.field-error')) box.textContent = errors[box.dataset.for] ?? '';
  const first = Object.keys(errors)[0];
  if (!first) return;
  const node = first === 'pours' ? $('pours') : $(first);
  node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = { ...state, name: $('name').value, grindSetting: grind.input.value, tempC: temp.input.value, doseG: dose.input.value, waterG: water.input.value };
  const { value, errors } = normalizeRecipeInput(input);
  showErrors(errors);
  if (Object.keys(errors).length) {
    showMessage('入力を直してください', 'error');
    return;
  }
  $('save').disabled = true;
  try {
    if (editId) await updateRecipe(db, editId, value);
    else await addRecipe(db, value);
    location.replace('recipes.html');
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error');
    $('save').disabled = false;
  }
});

$('delete').addEventListener('click', async () => {
  if (!(await askConfirm('このレシピを削除しますか？元に戻せません（これまでの抽出の記録は消えません）', { ok: '削除する', danger: true }))) return;
  await deleteRecipe(db, editId);
  location.replace('recipes.html');
});

async function init() {
  const equipment = await listEquipment(db);
  const groups = groupEquipmentByKind(equipment);
  grinders = groups.grinder;
  if (editId) {
    const recipe = await getRecipe(db, editId);
    if (!recipe) {
      $('title').textContent = 'レシピが見つかりません';
      form.hidden = true;
      form.after(el('p', { class: 'muted' }, '削除したのかもしれません。'), el('p', {}, el('a', { class: 'btn block', href: 'recipes.html' }, 'レシピの一覧へ')));
      return;
    }
    document.title = 'レシピの編集 - Pourfolio';
    $('title').textContent = 'レシピの編集';
    $('deleteRow').hidden = false;
    state = recipeToState(recipe);
    ratio = recipe.template?.ratio ?? ratioOf(recipe.doseG, recipe.waterG) ?? DEFAULT_RATIO;
    $('name').value = state.name;
  } else {
    const settings = await getSettings(db);
    state = newRecipeState({ doseG: doseFromSettings(settings), ...defaultEquipmentIds(equipment) });
    ratio = state.template.ratio;
  }
  fillSelect($('grinderId'), groups.grinder, state.grinderId);
  fillSelect($('dripperId'), groups.dripper, state.dripperId);
  fillSelect($('filterId'), groups.filter, state.filterId);
  fillSelect($('kettleId'), groups.kettle, state.kettleId);
  for (const k of ['grinderId', 'dripperId', 'filterId', 'kettleId']) state[k] = $(k).value;
  syncGrindStep();
  grind.set(state.grindSetting);
  $('bloomStir').checked = state.bloomStir;
  $('favorite').checked = state.favorite;
  $('memo').value = state.memo;
  syncTemplate();
  renderPours();
  syncNumbers();
}

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込めませんでした。開き直してください', 'error');
});
