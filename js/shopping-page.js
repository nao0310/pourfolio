// 買い物リスト（C5）：注文の目安日、次に買う候補、注文メモ、お届けの日数
import { openDb, readAll, getSettings, updateSettings } from './db.js';
import { restockPlan, restockText, shoppingCandidates, orderMemo } from './core/restock.js';
import { deliveryDays, DEFAULT_DELIVERY_DAYS } from './core/orders.js';
import { localYmd, formatG, formatYmdJa } from './core/format.js';
import { $, el, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
let plan = null;
let candidates = [];
const picked = new Set();

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
}

function renderDelivery(all, settings) {
  const d = deliveryDays(all.beans, settings.deliveryDays);
  $('deliveryNote').textContent = d.learned
    ? `これまでの${d.samples}回の注文では、中央値${d.days}日で届いています（この値を使います）。実績が2回より少ないときは、下の日数を使います。`
    : `注文日と到着日のある注文が2回以上になると、実績から計算します。それまでは下の日数を使います。`;
  if (document.activeElement !== $('deliveryDays')) $('deliveryDays').value = String(settings.deliveryDays ?? DEFAULT_DELIVERY_DAYS);
}

async function render() {
  const [all, settings] = await Promise.all([readAll(db), getSettings(db)]);
  const alive = (r) => r.deletedAt == null;
  const data = { beans: all.beans.filter(alive), txs: all.inventoryTx.filter(alive), brews: all.brews, tastings: all.tastings };
  plan = restockPlan({ ...data, settings, today: localYmd() });
  candidates = shoppingCandidates(data);
  renderPlan();
  renderCandidates();
  renderMemo();
  renderDelivery(all, settings);
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

registerServiceWorker();
render().catch((err) => {
  console.error(err);
  $('planTitle').textContent = '読み込みに失敗しました。開き直してください';
});
