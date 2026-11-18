// 買い物リスト（C5）：注文の目安日、次に買う候補、注文メモ、お届けの日数
import { openDb, readAll, getSettings, updateSettings } from './db.js';
import { restockPlan, restockText, shoppingCandidates, orderMemo, bulkBuyPlan, bulkBuyText, normalizeShippingInput } from './core/restock.js';
import { doseFromSettings } from './core/inventory.js';
import { freezerCount } from './core/frozen.js';
import { yen } from './core/cost.js';
import { deliveryDays, DEFAULT_DELIVERY_DAYS } from './core/orders.js';
import { localYmd, formatG, formatYmdJa } from './core/format.js';
import { roastPreferences, preferenceForBean, preferenceText } from './core/compare.js';
import { $, el, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
let plan = null;
let candidates = [];
const picked = new Set();
let data = null;
let settings = {};
/** 焙煎度比較（X27）でわかった産地ごとの好み */
let prefs = [];

function renderPlan() {
  const t = restockText(plan);
  $('planTitle').textContent = t.title;
  $('planText').textContent = t.text;
  $('planCard').classList.toggle('alert-card', plan.status === 'now' || plan.status === 'soon');
  const rows = [
    ['手元の豆', formatG(plan.onHandG)],
    plan.orderedCount > 0 && ['入荷待ち', `${plan.orderedCount}袋（約${formatG(plan.incomingG)}）`],
    plan.runoutYmd && ['なくなる日', `${formatYmdJa(plan.runoutYmd)}ごろ`],
    ['お届け', `${plan.deliveryDays}日${plan.deliveryLearned ? '（これまでの実績）' : ''}`],
    ['休ませる', `${plan.restDays}日${plan.roastLevel ? `（${plan.roastLevel}）` : ''}`],
  ].filter(Boolean);
  $('planNumbers').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

function candidateRow(c) {
  const facts = [
    c.avgStars != null ? `★${c.avgStars}（${c.rated}杯）` : 'まだ評価なし',
    `${c.bags}袋買った`,
    c.priceJpy != null ? `${c.priceJpy.toLocaleString('ja-JP')}円` : '',
    c.inStock ? '在庫あり' : '',
  ].filter(Boolean);
  // 焙煎度比較でわかった好み（同じ銘柄の袋の産地から）。違う焙煎度が好きなら知らせる
  const bean = data.beans.find((b) => b.name === c.name && b.roastLevel === c.roastLevel) ?? data.beans.find((b) => b.name === c.name);
  const pref = bean ? preferenceForBean(prefs, bean) : null;
  const prefNote = pref?.best ? `${preferenceText(pref)}${pref.best !== c.roastLevel ? `。次は「${pref.best}」で` : ''}` : '';
  return el(
    'div',
    { class: 'shop-row' },
    el(
      'label',
      { class: 'check-row' },
      el('input', {
        type: 'checkbox',
        checked: picked.has(c.key),
        onchange: (e) => {
          if (e.target.checked) picked.add(c.key);
          else picked.delete(c.key);
          renderMemo();
        },
      }),
      el(
        'span',
        { class: 'shop-main' },
        el('span', { class: 'shop-name' }, [c.name, c.roastLevel].filter(Boolean).join('　')),
        el('span', { class: 'muted' }, facts.join('・')),
        prefNote && el('span', { class: 'pref-note' }, prefNote),
      ),
    ),
    c.productUrl && el('a', { class: 'link-more', href: c.productUrl, target: '_blank', rel: 'noopener noreferrer' }, '店のページ'),
  );
}

function renderCandidates() {
  $('candidates').replaceChildren(
    ...(candidates.length ? candidates.map(candidateRow) : [el('p', { class: 'muted' }, '豆を登録すると、ここに候補が出ます。')]),
  );
}

function renderMemo() {
  const chosen = candidates.filter((c) => picked.has(c.key));
  $('memo').value = chosen.length ? orderMemo(chosen, plan) : '';
  $('memo').placeholder = '上の候補に印を付けると、ここにメモができます';
  $('copyMemo').disabled = chosen.length === 0;
  renderBulk();
}

/** 送料無料ラインのまとめ買い案 */
function renderBulk() {
  if (!data) return;
  const chosen = candidates.filter((c) => picked.has(c.key));
  const b = bulkBuyPlan({ picked: chosen, candidates, settings, portions: data.portions, beans: data.beans, doseG: doseFromSettings(settings) });
  $('bulkText').textContent = bulkBuyText(b);
  const list = b.status === 'short' ? b.suggestions : [];
  $('bulkList').replaceChildren(
    ...list.map((s) => {
      const facts = [`＋${yen(s.addJpy)}`];
      if (s.addG != null) facts.push(`約${formatG(s.addG)}`);
      if (s.fits === true) facts.push(`冷凍庫に入ります（${s.portionsNeeded}袋分）`);
      if (s.fits === false) facts.push(`冷凍庫の空き（${b.freeSlots}袋）に入りきりません（${s.portionsNeeded}袋分）`);
      return el(
        'div',
        { class: 'shop-row' },
        el('span', { class: 'shop-main' }, el('span', { class: 'shop-name' }, s.names.join('＋')), el('span', { class: 'muted' }, facts.join('・'))),
        el(
          'button',
          {
            class: 'btn secondary small',
            type: 'button',
            onclick: () => {
              for (const k of s.keys) picked.add(k);
              renderCandidates();
              renderMemo();
              showMessage(`${s.names.join('・')}を注文メモに足しました`);
            },
          },
          '足す',
        ),
      );
    }),
  );
  const notes = [];
  if (b.status === 'short' && !list.length) notes.push('ほかの候補を足してもラインに届きません（価格が未入力の候補は使えません）');
  if (b.status === 'short' && b.freeSlots == null) notes.push('「冷凍庫に入る袋の数」を入れると、足した豆が冷凍庫に入るかも確かめます');
  if (b.status === 'short' && list.length) notes.push('足した分は、飲み頃を過ぎる前に1杯分ずつ冷凍しておくと長く楽しめます');
  $('bulkNote').textContent = notes.join('。');
}

function renderShipSettings() {
  for (const k of ['shippingJpy', 'freeShippingJpy', 'freezerSlots']) {
    if (document.activeElement !== $(k)) $(k).value = settings[k] != null ? String(settings[k]) : '';
  }
  $('freezerHint').textContent = `いま冷凍中の袋：${freezerCount(data?.portions ?? [])}袋`;
}

function renderDelivery(all, settings) {
  const d = deliveryDays(all.beans, settings.deliveryDays);
  $('deliveryNote').textContent = d.learned
    ? `これまでの${d.samples}回の注文では、中央値${d.days}日で届いています（この値を使います）。実績が2回より少ないときは、下の日数を使います。`
    : `注文日と到着日のある注文が2回以上になると、実績から計算します。それまでは下の日数を使います。`;
  if (document.activeElement !== $('deliveryDays')) $('deliveryDays').value = String(settings.deliveryDays ?? DEFAULT_DELIVERY_DAYS);
}

async function render() {
  const [all, loaded] = await Promise.all([readAll(db), getSettings(db)]);
  settings = loaded;
  const alive = (r) => r.deletedAt == null;
  data = {
    beans: all.beans.filter(alive),
    txs: all.inventoryTx.filter(alive),
    portions: all.frozenPortions.filter(alive),
    brews: all.brews,
    tastings: all.tastings,
  };
  prefs = roastPreferences(all.experiments, data.beans);
  plan = restockPlan({ ...data, settings, today: localYmd() });
  candidates = shoppingCandidates(data);
  renderPlan();
  renderCandidates();
  renderMemo();
  renderDelivery(all, settings);
  renderShipSettings();
}

$('copyMemo').addEventListener('click', async () => {
  const text = $('memo').value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showMessage('注文メモをコピーしました');
  } catch {
    $('memo').focus();
    $('memo').select();
    showMessage('コピーできませんでした。メモを長押しして「コピー」を選んでください', 'error');
  }
});

$('deliveryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const n = Number(String($('deliveryDays').value).normalize('NFKC').trim());
  if (!Number.isInteger(n) || n < 0 || n > 30) return showMessage('0〜30の日数で入れてください', 'error', 'deliveryMsg');
  await updateSettings(db, { deliveryDays: n });
  showMessage('保存しました', 'ok', 'deliveryMsg');
  await render();
});

$('shipForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const raw = { shippingJpy: $('shippingJpy').value, freeShippingJpy: $('freeShippingJpy').value, freezerSlots: $('freezerSlots').value };
  const { value, errors } = normalizeShippingInput(raw);
  for (const span of event.target.querySelectorAll('.field-error')) span.textContent = errors[span.dataset.for] ?? '';
  if (Object.keys(errors).length) return;
  await updateSettings(db, value);
  showMessage('保存しました', 'ok', 'shipMsg');
  await render();
});

registerServiceWorker();
render().catch((err) => {
  console.error(err);
  $('planTitle').textContent = '読み込みに失敗しました。開き直してください';
});
