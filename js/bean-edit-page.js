// 豆の登録・編集（C1）
import { openDb, addBean, updateBean, getBeanWithTx, listBeans } from './db.js';
import { normalizeBeanInput, beanToFormValues, PROCESS_OPTIONS, VARIETY_OPTIONS, DEFAULT_SHOP } from './core/beans.js';
import { ROAST_LEVELS, initialStockG } from './core/roast.js';
import { formatG } from './core/format.js';
import { $, el, queryParam, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const form = $('form');
const editId = queryParam('id');
let allBeans = [];

// ---- 選択肢を作る ----
$('roastChips').replaceChildren(
  ...ROAST_LEVELS.map((lv) =>
    el('label', { class: 'chip' }, el('input', { type: 'radio', name: 'roastLevel', value: lv }), el('span', {}, lv)),
  ),
);
const fillSelect = (select, options) =>
  select.replaceChildren(
    el('option', { value: '' }, '（未入力）'),
    ...options.map((o) => el('option', { value: o }, o)),
    el('option', { value: 'その他' }, 'その他（入力する）'),
  );
fillSelect($('variety'), VARIETY_OPTIONS);
fillSelect($('process'), PROCESS_OPTIONS);

/** 「その他」を選んだときだけ自由入力欄を出す */
function syncOtherInputs() {
  for (const k of ['variety', 'process']) {
    const other = form.elements[`${k}Other`];
    other.hidden = form.elements[k].value !== 'その他';
  }
}

// ---- フォームの読み書き ----
function readForm() {
  const raw = {};
  for (const [k, v] of new FormData(form)) raw[k] = String(v);
  return raw;
}

function writeForm(values) {
  for (const [k, v] of Object.entries(values)) {
    const field = form.elements[k];
    if (!field) continue;
    if (field instanceof RadioNodeList) {
      for (const r of field) r.checked = r.value === v;
    } else {
      field.value = v;
    }
  }
  syncOtherInputs();
}

function showErrors(errors) {
  for (const box of form.querySelectorAll('.field-error')) box.textContent = errors[box.dataset.for] ?? '';
  const first = Object.keys(errors)[0];
  if (!first) return;
  const target = form.elements[first];
  const node = target instanceof RadioNodeList ? target[0] : target;
  if (node?.closest('details')) node.closest('details').open = true;
  node?.focus?.({ preventScroll: true });
  node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

/** 在庫に入る量の見込みを表示する */
function updatePreview() {
  const { value } = normalizeBeanInput(readForm());
  const stock = initialStockG({ ...value, id: editId }, allBeans);
  const box = $('stockPreview');
  if (!stock) {
    box.textContent = '表記重量か実重量を入れると、在庫に入る量を表示します';
    box.className = 'stock-preview muted';
    return;
  }
  box.className = 'stock-preview';
  if (!stock.estimated) {
    box.textContent = `在庫に入る量：${formatG(stock.g)}`;
    return;
  }
  const how = stock.learned ? 'これまでの豆の実績' : `${value.roastLevel || '焙煎度不明'}の目安`;
  box.textContent = `在庫に入る量：約${formatG(stock.g)}（生豆時から${stock.lossPct}%減る見積もり。${how}）。届いたら実重量を量って入れると正確になります`;
}

form.addEventListener('input', (event) => {
  if (event.target.name === 'variety' || event.target.name === 'process') syncOtherInputs();
  updatePreview();
});
form.addEventListener('change', updatePreview);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const { value, errors } = normalizeBeanInput(readForm());
  showErrors(errors);
  if (Object.keys(errors).length) {
    showMessage('入力を直してください', 'error');
    return;
  }
  $('save').disabled = true;
  try {
    const saved = editId ? await updateBean(db, editId, value) : await addBean(db, value);
    location.replace(`bean.html?id=${encodeURIComponent(saved.id)}`);
  } catch (err) {
    console.error(err);
    showMessage('保存に失敗しました', 'error');
    $('save').disabled = false;
  }
});

async function init() {
  allBeans = await listBeans(db);
  if (editId) {
    const found = await getBeanWithTx(db, editId);
    if (!found) {
      $('title').textContent = '豆が見つかりません';
      form.hidden = true;
      return;
    }
    document.title = '豆の編集 - Pourfolio';
    $('title').textContent = '豆の編集';
    $('save').textContent = '保存する';
    $('back').textContent = found.bean.name;
    $('back').href = `bean.html?id=${encodeURIComponent(editId)}`;
    writeForm(beanToFormValues(found.bean));
  } else {
    writeForm({ shop: DEFAULT_SHOP });
  }
  updatePreview();
}

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込みに失敗しました', 'error');
});
