// お店で飲んだ1杯（X37、D-188）：記録するだけ。手で淹れた記録とは別の表で、分析には入れない
import { openDb, listCafeVisits, addCafeVisit, updateCafeVisit, deleteCafeVisit } from './db.js';
import {
  CAFE_METHODS,
  CAFE_TEMPS,
  normalizeCafeInput,
  cafeToFormValues,
  searchCafeVisits,
  shopNameSuggestions,
  cafeSummary,
  toLocalInputValue,
} from './core/cafe.js';
import { ROAST_LEVELS } from './core/roast.js';
import { formatDateTimeJa } from './core/format.js';
import { renderStars } from './tasting-parts.js';
import { $, el, showMessage, showToast } from './ui.js';
import { askConfirm } from './confirm-box.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const form = $('form');
/** 直している記録のID（足すときは null） */
let editId = null;
/** ★の入力（tasting-parts の renderStars が書き換える） */
const starState = { stars: null };
/** 読み込んだ記録（検索のたびに読み直さない） */
let visits = [];

const chip = (name, o) => el('label', { class: 'chip' }, el('input', { type: 'radio', name, value: o.key }), el('span', {}, o.label));
$('methodChips').replaceChildren(...CAFE_METHODS.map((o) => chip('method', o)));
$('tempChips').replaceChildren(...CAFE_TEMPS.map((o) => chip('temp', o)));
$('roastLevel').replaceChildren(el('option', { value: '' }, '（わからない）'), ...ROAST_LEVELS.map((lv) => el('option', { value: lv }, lv)));

// 選んだチップをもう一度押すと外せる（淹れ方・ホットかアイスは書かなくてもよいので）
for (const box of [$('methodChips'), $('tempChips')]) {
  box.addEventListener('pointerdown', (e) => {
    const input = e.target.closest('.chip')?.querySelector('input');
    if (input) input.dataset.wasChecked = String(input.checked);
  });
  box.addEventListener('click', (e) => {
    const input = e.target.closest('.chip')?.querySelector('input');
    if (!input || e.target !== input) return;
    if (input.dataset.wasChecked === 'true') input.checked = false;
    delete input.dataset.wasChecked;
  });
}

const drawStars = () => renderStars($('stars'), starState, () => {});

function readForm() {
  const raw = {};
  for (const [k, v] of new FormData(form)) raw[k] = String(v);
  raw.stars = starState.stars == null ? '' : String(starState.stars);
  return raw;
}

function writeForm(values) {
  for (const [k, v] of Object.entries(values)) {
    if (k === 'stars') continue;
    if (k === 'method' || k === 'temp') {
      for (const r of form.querySelectorAll(`input[name="${k}"]`)) r.checked = r.value === v;
      continue;
    }
    const field = form.elements[k];
    if (field && typeof v === 'string') field.value = v;
  }
  starState.stars = values.stars ? Number(values.stars) : null;
  drawStars();
}

function showErrors(errors) {
  for (const box of form.querySelectorAll('.field-error')) box.textContent = errors[box.dataset.for] ?? '';
  const first = Object.keys(errors)[0];
  if (first) form.elements[first]?.focus?.();
}

function resetForm() {
  form.reset();
  editId = null;
  starState.stars = null;
  drawStars();
  form.elements.at.value = toLocalInputValue(new Date());
  showErrors({});
  $('formTitle').textContent = 'お店の1杯を記録する';
  $('save').textContent = '記録する';
  $('cancelEdit').hidden = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const { value, errors } = normalizeCafeInput(readForm());
  showErrors(errors);
  if (Object.keys(errors).length) {
    showMessage('入力を直してください', 'error');
    return;
  }
  $('save').disabled = true;
  try {
    if (editId) await updateCafeVisit(db, editId, value);
    else await addCafeVisit(db, value);
    showToast(editId ? `「${value.shopName}」の記録を直しました` : `「${value.shopName}」の1杯を記録しました`);
    resetForm();
    showMessage('', 'ok');
    await render();
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error');
  } finally {
    $('save').disabled = false;
  }
});

$('cancelEdit').addEventListener('click', () => {
  resetForm();
  showMessage('', 'ok');
});

function startEdit(v) {
  resetForm();
  editId = v.id;
  writeForm(cafeToFormValues(v));
  $('formTitle').textContent = `「${v.shopName}」の記録を直す`;
  $('save').textContent = '保存する';
  $('cancelEdit').hidden = false;
  form.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function row(v) {
  const title = [v.shopName, v.drinkName].filter(Boolean).join('　');
  const summary = cafeSummary(v);
  return el(
    'div',
    { class: 'wish-row' },
    el(
      'div',
      { class: 'shop-main' },
      el('span', { class: 'shop-name' }, title, v.stars != null ? el('span', { class: 'wr-star' }, `　${'★'.repeat(v.stars)}`) : null),
      el('span', { class: 'muted' }, formatDateTimeJa(v.at)),
      summary && el('span', { class: 'muted' }, summary),
      v.memo && el('span', { class: 'muted small' }, v.memo),
    ),
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn secondary small', type: 'button', onclick: () => startEdit(v) }, '編集する'),
      el(
        'button',
        {
          class: 'btn secondary small',
          type: 'button',
          onclick: async () => {
            if (!(await askConfirm(`「${v.shopName}」の記録を削除しますか？元に戻せません`, { ok: '削除する', danger: true }))) return;
            await deleteCafeVisit(db, v.id);
            if (editId === v.id) resetForm();
            showToast(`「${v.shopName}」の記録を削除しました`);
            await render();
          },
        },
        '削除する',
      ),
    ),
  );
}

function drawList() {
  const q = $('search').value;
  const found = searchCafeVisits(visits, q);
  $('listTitle').textContent = `これまでの記録（${visits.length}杯）`;
  $('list').replaceChildren(
    ...(found.length
      ? found.map(row)
      : [el('p', { class: 'muted' }, visits.length ? '当てはまる記録はありません' : 'まだお店の1杯の記録はありません。上の欄から記録すると表示します')]),
  );
}

async function render() {
  visits = await listCafeVisits(db);
  $('shopList').replaceChildren(...shopNameSuggestions(visits).map((s) => el('option', { value: s })));
  drawList();
}

$('search').addEventListener('input', drawList);

resetForm();
registerServiceWorker();
render().catch((err) => {
  console.error(err);
  $('list').textContent = '読み込めませんでした。開き直してください';
});
