// 注文メールから入荷待ちの豆を登録する（X29）
import { openDb, addOrder, listOrders } from './db.js';
import { parseOrderEmail } from './core/tonya.js';
import { normalizeOrderItem, orderFields } from './core/orders.js';
import { ROAST_LEVELS } from './core/roast.js';
import { formatG, formatYmdJa, formatDateJa, localYmd } from './core/format.js';
import { $, el, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';
import { askConfirm } from './confirm-box.js';

const db = openDb();
let parsed = null;
/** 画面で直した品目（parsed.items と同じ並び） */
let rows = [];

const yen = (n) => (n == null ? '' : `${n.toLocaleString('ja-JP')}円`);

function bagCount() {
  return rows.filter((r) => r.checked).reduce((s, r) => s + r.item.qty, 0);
}

function renderSaveButton() {
  const n = bagCount();
  $('save').textContent = n ? `入荷待ちとして登録（${n}袋）` : '登録する豆に印を付けてください';
  $('save').disabled = n === 0;
}

function itemCard(row) {
  const it = row.item;
  const roastSelect = el(
    'select',
    {
      'aria-label': '焙煎度',
      onchange: (e) => {
        it.roastLevel = e.target.value;
      },
    },
    el('option', { value: '' }, '（焙煎度なし）'),
    ...ROAST_LEVELS.map((lv) => el('option', { value: lv, selected: lv === it.roastLevel }, lv)),
  );
  const facts = [
    it.labelWeightG ? `${formatG(it.labelWeightG)}（${it.labelWeightBasis === 'roasted' ? '焙煎後' : '生豆時'}）` : '重さ不明',
    `× ${it.qty}`,
    yen(it.priceJpy),
  ].filter(Boolean);
  return el(
    'div',
    { class: `card import-item${row.checked ? '' : ' off'}` },
    el(
      'label',
      { class: 'check-row' },
      el('input', {
        type: 'checkbox',
        checked: row.checked,
        onchange: (e) => {
          row.checked = e.target.checked;
          e.target.closest('.import-item').classList.toggle('off', !row.checked);
          renderSaveButton();
        },
      }),
      el('span', {}, row.note || '登録する'),
    ),
    el(
      'label',
      { class: 'field' },
      el('span', { class: 'label' }, '銘柄'),
      el('input', {
        type: 'text',
        value: it.name,
        autocomplete: 'off',
        oninput: (e) => {
          it.name = e.target.value;
        },
      }),
    ),
    el('div', { class: 'import-sub' }, roastSelect, el('span', { class: 'muted' }, facts.join('　'))),
  );
}

async function render() {
  const o = parsed;
  const orders = await listOrders(db);
  const dup = o.orderNo && orders.find((x) => x.orderNo === o.orderNo);
  const info = [
    ['注文番号', o.orderNo || '（読めませんでした）'],
    ['注文日', o.orderDate ? formatYmdJa(o.orderDate, { withYear: true }) : '（読めませんでした。今日にします）'],
    ['送料', o.shippingJpy != null ? yen(o.shippingJpy) : '（読めませんでした）'],
  ];
  $('orderInfo').replaceChildren(...info.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  $('dupNote').hidden = !dup;
  $('dupNote').textContent = dup ? `この注文（${dup.orderNo}）は${formatDateJa(dup.createdAt)}に登録済みです。もう一度登録すると、同じ豆が増えます。` : '';
  $('items').replaceChildren(...rows.map(itemCard));
  $('others').textContent = o.others.length ? `豆以外の品物（登録しません）：${o.others.map((x) => x.name).join('、')}` : '';
  $('result').hidden = false;
  renderSaveButton();
}

$('read').addEventListener('click', async () => {
  const text = $('mail').value;
  if (!text.trim()) return showMessage('メールの本文を貼り付けてください', 'error', 'readMsg');
  parsed = parseOrderEmail(text);
  if (!parsed.found) {
    $('result').hidden = true;
    return showMessage('コーヒー豆の品目が見つかりませんでした。「ご注文内容」の［商品］の部分まで貼り付けたか確かめてください', 'error', 'readMsg');
  }
  // 生豆（焼かない）は、淹れる豆ではないので最初は印を外す
  rows = parsed.items.map((item) => ({ item: { ...item }, checked: !item.isGreen, note: item.isGreen ? '生豆（焼かない）。登録するときは印を付ける' : '' }));
  showMessage(`${parsed.items.length}つの豆を読み取りました`, 'ok', 'readMsg');
  await render();
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('clear').addEventListener('click', () => {
  $('mail').value = '';
  $('result').hidden = true;
  parsed = null;
  rows = [];
  showMessage('', 'ok', 'readMsg');
});

$('save').addEventListener('click', async () => {
  const chosen = rows.filter((r) => r.checked);
  const items = [];
  for (const r of chosen) {
    const { value, errors } = normalizeOrderItem(r.item);
    if (Object.keys(errors).length) return showMessage(`「${r.item.name || '銘柄なし'}」：${Object.values(errors)[0]}`, 'error');
    items.push(value);
  }
  if (!items.length) return;
  if (!$('dupNote').hidden && !(await askConfirm('この注文は登録済みです。もう一度登録しますか？', { ok: 'もう一度登録する' }))) return;
  $('save').disabled = true;
  try {
    const orderDate = parsed.orderDate ?? localYmd();
    const { beans } = await addOrder(db, orderFields({ orderNo: parsed.orderNo, orderDate, shippingJpy: parsed.shippingJpy, items }), items);
    location.replace(`beans.html?registered=${beans.length}`);
  } catch (err) {
    console.error(err);
    showMessage('登録できませんでした。もう一度押してください', 'error');
    $('save').disabled = false;
  }
});

registerServiceWorker();
