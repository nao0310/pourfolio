// 器具の一覧（D1）
import { openDb, listEquipment } from './db.js';
import { EQUIPMENT_KINDS, groupEquipmentByKind, equipmentSummary } from './core/equipment.js';
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

async function render() {
  const groups = groupEquipmentByKind(await listEquipment(db));
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
  $('list').replaceChildren(el('p', { class: 'error' }, '器具の読み込みに失敗しました'));
});
