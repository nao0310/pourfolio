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
import { $, el, queryParam, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';

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

/** 種類に合わせて、詳細の欄と名前の例を切り替える */
function syncKind() {
  const kind = form.elements.kind.value;
  for (const card of form.querySelectorAll('[data-kind]')) card.hidden = card.dataset.kind !== kind;
  $('modelChips').hidden = kind !== 'dripper';
  form.elements.name.placeholder = NAME_PLACEHOLDERS[kind] ?? '名前';
  $('bleachField').hidden = form.elements.filterMaterial.value !== 'paper';
}

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
  const node = target instanceof RadioNodeList ? target[0] : target;
  node?.focus?.({ preventScroll: true });
  node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

form.addEventListener('change', syncKind);

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
  if (!confirm('この器具を削除しますか？（レシピに入っている器具の名前は表示されなくなります）')) return;
  await deleteEquipment(db, editId);
  location.replace('equipment.html');
});

async function init() {
  if (editId) {
    const eq = await getEquipment(db, editId);
    if (!eq) {
      $('title').textContent = '器具が見つかりません';
      form.hidden = true;
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
