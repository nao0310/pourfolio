// 器具と水の一覧（D1・D3）と、グラインダーの目盛りの換算（D2）
import { openDb, listEquipment } from './db.js';
import { EQUIPMENT_KINDS, groupEquipmentByKind, equipmentSummary } from './core/equipment.js';
import { scaleOf, convertSetting, grindSizeText } from './core/grinder-scale.js';
import { $, el } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();

function itemRow(eq) {
  const summary = equipmentSummary(eq);
  return el(
    'a',
    { class: 'list-row', href: `equipment-edit.html?id=${encodeURIComponent(eq.id)}` },
    el(
      'span',
      { class: 'list-row-main' },
      el('span', { class: 'list-row-title' }, eq.name),
      summary && el('span', { class: 'muted' }, summary),
    ),
    eq.isDefault && el('span', { class: 'pill tag' }, 'いつも使う'),
  );
}

// ---- 目盛りの換算（D2） ----

let grinders = [];

function renderConvert() {
  const from = grinders.find((g) => g.id === $('convFrom').value);
  const setting = $('convSetting').value.normalize('NFKC').trim();
  if (!from || setting === '') {
    $('convResult').replaceChildren();
    return;
  }
  const own = grindSizeText(from, setting);
  if (!own) {
    $('convResult').replaceChildren(el('li', { class: 'muted' }, 'この目盛りは目盛り表から求められません（数字で入れてください）'));
    return;
  }
  $('convResult').replaceChildren(
    el('li', {}, `${from.name} ${setting} は ${own}`),
    ...grinders
      .filter((g) => g.id !== from.id)
      .map((g) => {
        const r = convertSetting(from, setting, g);
        return el('li', {}, r ? `→ ${g.name}：${r.setting}${r.outside ? '（表の外側を延ばした値）' : ''}` : `→ ${g.name}：換算できません`);
      }),
  );
}

function setupConvert(list) {
  grinders = list.filter((e) => e.kind === 'grinder' && scaleOf(e).length >= 2);
  $('convertCard').hidden = grinders.length < 2;
  if (grinders.length < 2) return;
  $('convFrom').replaceChildren(...grinders.map((g) => el('option', { value: g.id }, g.name)));
}

$('convFrom').addEventListener('change', renderConvert);
$('convSetting').addEventListener('input', renderConvert);

async function render() {
  const all = await listEquipment(db);
  setupConvert(all);
  const groups = groupEquipmentByKind(all);
  const cards = Object.entries(EQUIPMENT_KINDS).map(([kind, label]) => {
    const items = groups[kind] ?? [];
    return el(
      'section',
      { class: 'card' },
      el('h2', {}, label),
      items.length
        ? el('div', { class: 'list' }, ...items.map(itemRow))
        : el(
            'p',
            { class: 'muted' },
            'まだありません。',
            el('a', { href: `equipment-edit.html?kind=${kind}` }, `${label}を登録`),
          ),
    );
  });
  $('list').replaceChildren(...cards);
}

registerServiceWorker();
render().catch((err) => {
  console.error(err);
  $('list').replaceChildren(el('p', { class: 'error' }, '器具を読み込めませんでした。開き直してください'));
});
