// 器具の登録・編集（D1）
import { openDb, addEquipment, updateEquipment, deleteEquipment, getEquipment } from './db.js';
import {
  EQUIPMENT_KINDS,
  DRIPPER_MODELS,
  DRIPPER_SHAPES,
  FILTER_MATERIALS,
  FILTER_BLEACH,
  GRINDER_BURRS,
  NAME_PLACEHOLDERS,
  normalizeEquipmentInput,
  equipmentToFormValues,
} from './core/equipment.js';
import { GRIND_SIZES, sizeWord } from './core/grinder-scale.js';
import { WATER_ITEMS, normalizeWaterInput, waterCheck } from './core/water.js';
import { $, el, queryParam, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';
import { askConfirm } from './confirm-box.js';

const db = openDb();
const form = $('form');
const editId = queryParam('id');

// ---- 選択肢を作る ----
const radioChips = (name, dict) =>
  Object.entries(dict).map(([value, label]) =>
    el('label', { class: 'chip' }, el('input', { type: 'radio', name, value }), el('span', {}, label)),
  );
$('kindChips').replaceChildren(...radioChips('kind', EQUIPMENT_KINDS));
$('shapeChips').replaceChildren(...radioChips('shape', DRIPPER_SHAPES));
$('filterMaterialChips').replaceChildren(...radioChips('filterMaterial', FILTER_MATERIALS));
$('bleachChips').replaceChildren(...radioChips('bleach', FILTER_BLEACH));
$('burrChips').replaceChildren(...radioChips('burr', GRINDER_BURRS));
// ドリッパーの名前は候補から1タップで入れられる
$('modelChips').replaceChildren(
  ...DRIPPER_MODELS.map((m) =>
    el(
      'button',
      {
        type: 'button',
        class: 'chip-btn',
        onclick: () => {
          form.elements.name.value = m;
          form.elements.name.focus();
        },
      },
      m,
    ),
  ),
);

// ---- グラインダーの目盛り表（D2） ----

/** 目盛り表の1行（目盛り・粒度µm・言葉の選択） */
function scaleRow(row = { setting: '', um: '' }) {
  const setting = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'scale-setting', 'aria-label': '目盛り', placeholder: '目盛り', value: row.setting });
  const um = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'scale-um', 'aria-label': '粒度（µm）', placeholder: 'µm', value: row.um });
  const word = el(
    'select',
    { class: 'scale-word', 'aria-label': '粒度の言葉' },
    el('option', { value: '' }, '言葉'),
    ...GRIND_SIZES.map((g) => el('option', { value: String(g.um) }, `${g.label}（${g.um}）`)),
  );
  const syncWord = () => {
    const n = Number(um.value.normalize('NFKC'));
    word.title = n > 0 ? sizeWord(n) : '';
  };
  word.addEventListener('change', () => {
    if (word.value) um.value = word.value;
    word.value = '';
    syncWord();
  });
  um.addEventListener('input', syncWord);
  const node = el(
    'div',
    { class: 'scale-row' },
    setting,
    el('span', { class: 'muted' }, '→'),
    um,
    el('span', { class: 'muted' }, 'µm'),
    word,
    el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'この行を消す', onclick: () => node.remove() }, '×'),
  );
  syncWord();
  return node;
}

function setScaleRows(rows) {
  const list = rows?.length ? rows : [{ setting: '', um: '' }, { setting: '', um: '' }];
  $('scaleRows').replaceChildren(...list.map(scaleRow));
}

function readScaleRows() {
  return [...$('scaleRows').querySelectorAll('.scale-row')].map((r) => ({
    setting: r.querySelector('.scale-setting').value,
    um: r.querySelector('.scale-um').value,
  }));
}

$('addScaleRow').addEventListener('click', () => {
  $('scaleRows').append(scaleRow());
  $('scaleRows').lastElementChild.querySelector('input').focus();
});

// ---- 水の成分（D3） ----

$('waterFields').replaceChildren(
  ...WATER_ITEMS.map((it) =>
    el(
      'label',
      { class: 'field' },
      el('span', { class: 'label' }, it.label),
      el(
        'span',
        { class: 'with-unit' },
        el('input', { type: 'text', inputmode: 'decimal', name: it.key, autocomplete: 'off' }),
        it.unit ? el('span', {}, it.unit) : '',
      ),
      el('span', { class: 'field-error', data: { for: it.key } }),
    ),
  ),
);

function renderWaterCheck() {
  const { value } = normalizeWaterInput(readForm());
  $('waterCheck').replaceChildren(
    ...waterCheck(value).map((c) =>
      el(
        'li',
        { class: `water-${c.status}` },
        el('strong', {}, c.label),
        ' ',
        el('span', {}, c.status === 'none' ? '未入力' : `${c.value}${c.unit ? ` ${c.unit}` : ''}：${c.text}`),
        el('span', { class: 'muted small block' }, c.rangeText),
      ),
    ),
  );
}

/** 種類に合わせて、詳細の欄と名前の例を切り替える */
function syncKind() {
  const kind = form.elements.kind.value;
  for (const card of form.querySelectorAll('[data-kind]')) card.hidden = card.dataset.kind !== kind;
  $('modelChips').hidden = kind !== 'dripper';
  form.elements.name.placeholder = NAME_PLACEHOLDERS[kind] ?? '名前';
  $('bleachField').hidden = form.elements.filterMaterial.value !== 'paper';
  if (kind === 'water') renderWaterCheck();
}

function readForm() {
  const raw = {};
  for (const [k, v] of new FormData(form)) raw[k] = String(v);
  raw.scale = readScaleRows();
  return raw;
}

function writeForm(values) {
  setScaleRows(values.scale);
  for (const [k, v] of Object.entries(values)) {
    if (k === 'scale') continue;
    const field = form.elements[k];
    if (!field) continue;
    if (field instanceof RadioNodeList) {
      for (const r of field) r.checked = r.value === v;
    } else if (field.type === 'checkbox') {
      field.checked = Boolean(v);
    } else {
      field.value = v;
    }
  }
  syncKind();
}

function showErrors(errors) {
  for (const box of form.querySelectorAll('.field-error')) box.textContent = errors[box.dataset.for] ?? '';
  const first = Object.keys(errors)[0];
  if (!first) return;
  const target = form.elements[first];
  const node = (target instanceof RadioNodeList ? target[0] : target) ?? form.querySelector('.field-error:not(:empty)');
  node?.focus?.({ preventScroll: true });
  node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

form.addEventListener('change', syncKind);
form.addEventListener('input', (e) => {
  if (WATER_ITEMS.some((it) => it.key === e.target.name)) renderWaterCheck();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const { value, errors } = normalizeEquipmentInput(readForm());
  showErrors(errors);
  if (Object.keys(errors).length) {
    showMessage('入力を直してください', 'error');
    return;
  }
  $('save').disabled = true;
  try {
    if (editId) await updateEquipment(db, editId, value);
    else await addEquipment(db, value);
    location.replace('equipment.html');
  } catch (err) {
    console.error(err);
    showMessage('保存に失敗しました', 'error');
    $('save').disabled = false;
  }
});

$('delete').addEventListener('click', async () => {
  if (!(await askConfirm('この器具（水）を削除しますか？元に戻せません（レシピに入っている器具の名前は表示されなくなります）', { ok: '削除する', danger: true }))) return;
  await deleteEquipment(db, editId);
  location.replace('equipment.html');
});

async function init() {
  if (editId) {
    const eq = await getEquipment(db, editId);
    if (!eq) {
      // 削除した器具を開いた：何が起きたかと戻り道を出す（2-8の51番）
      document.title = '器具が見つかりません - Pourfolio';
      $('title').textContent = '器具が見つかりません';
      form.hidden = true;
      form.after(
        el('p', { class: 'muted' }, '削除したのかもしれません。'),
        el('p', {}, el('a', { class: 'btn block', href: 'equipment.html' }, '器具の一覧へ')),
      );
      return;
    }
    document.title = '器具の編集 - Pourfolio';
    $('title').textContent = '器具の編集';
    $('save').textContent = '保存する';
    $('deleteRow').hidden = false;
    writeForm(equipmentToFormValues(eq));
  } else {
    const kind = queryParam('kind');
    writeForm({ kind: Object.hasOwn(EQUIPMENT_KINDS, kind) ? kind : 'dripper' });
  }
}

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込みに失敗しました', 'error');
});
