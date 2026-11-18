// 豆の詳細：飲み頃（C3）、残量と在庫履歴（C2）、豆の情報（C1）
import {
  openDb,
  getBeanWithTx,
  getSettings,
  recordCupUsage,
  measureBean,
  addInventoryTx,
  deleteInventoryTx,
  setBeanStatus,
  deleteBean,
  listBeans,
  markArrived,
  freezeBean,
  takeOutPortion,
} from './db.js';
import { normalizeFreezeInput, portionsOf, stockParts, stockPartsText, portionText, labelRange, MAX_PORTIONS } from './core/frozen.js';
import { arrivalChanges } from './core/orders.js';
import { initialStockG } from './core/roast.js';
import { originText, BEAN_STATUS, WEIGHT_BASIS, parseNumber } from './core/beans.js';
import { remainingG, cupsLeft, consumptionPace, emptyForecast, doseFromSettings, sortTxNewestFirst, TX_KINDS } from './core/inventory.js';
import { freshness, FRESHNESS_WINDOWS, FALLBACK_GROUP, STAGES } from './core/freshness.js';
import { roastGroup, ROAST_GROUPS } from './core/roast.js';
import { localYmd, formatYmdJa, formatG, formatDateTimeJa } from './core/format.js';
import { $, el, queryParam, showMessage, freshnessPill, frozenPill, stepperField } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const beanId = queryParam('id');
let doseG = 15;

/** 数字の入力を読む（0より大きく、上限以下） */
function readGrams(input, max = 5000) {
  const g = parseNumber(input.value);
  if (g == null || Number.isNaN(g) || g <= 0 || g > max) return null;
  return Math.round(g * 10) / 10;
}

/** 飲み頃の帯：4段階を横に並べ、今日の位置に印を付ける */
function renderBand(f, group) {
  const w = FRESHNESS_WINDOWS[group];
  const total = w.pastUntil + 8; // 「早めに消費」も少し見せる
  const seg = (stage, from, to) =>
    el('span', { class: `seg stage-${stage}`, style: `flex-grow:${to - from}` }, to - from >= 3 ? STAGES[stage] : '');
  const children = [
    seg('resting', 0, w.restUntil + 1),
    seg('peak', w.restUntil + 1, w.peakUntil + 1),
    seg('past', w.peakUntil + 1, w.pastUntil + 1),
    seg('useSoon', w.pastUntil + 1, total),
  ];
  if (f) {
    const pos = Math.min(Math.max(f.days + 0.5, 0), total) / total;
    children.push(el('span', { class: 'band-marker', style: `left:${(pos * 100).toFixed(1)}%` }));
  }
  $('band').replaceChildren(...children);
}

function renderFreshness(bean, parts) {
  const f = freshness(bean.roastDate, bean.roastLevel, localYmd());
  const group = roastGroup(bean.roastLevel) ?? FALLBACK_GROUP;
  // 常温が0で冷凍だけ残っている豆は、冷凍中は日数を数えないので「冷凍中」と出す
  const frozenOnly = parts.roomG <= 0 && parts.frozenCount > 0;
  $('pill').replaceChildren(frozenOnly ? frozenPill() : freshnessPill(f));
  if (frozenOnly) {
    $('freshText').textContent = '常温の豆はなく、冷凍の袋だけ残っています。冷凍中は焙煎からの日数を数えません。';
  } else if (!f) {
    $('freshText').textContent = '焙煎日を入れると、飲み頃を表示します。';
  } else {
    const head = f.days >= 0 ? `焙煎から${f.days}日` : `焙煎まであと${-f.days}日`;
    $('freshText').textContent = f.next ? `${head}。あと${f.next.inDays}日で「${f.next.label}」` : `${head}。早めに飲み切りましょう`;
  }
  const w = FRESHNESS_WINDOWS[group];
  const groupLabel = ROAST_GROUPS[group].label;
  $('freshNote').textContent = `${bean.roastLevel ? '' : '焙煎度が未入力のため、'}${groupLabel}の目安：飲み頃は${w.restUntil + 1}〜${w.peakUntil}日目`;
  renderBand(f, group);
}

function renderStock(bean, txs, parts) {
  const rest = parts.totalG;
  $('remain').textContent = formatG(Math.max(rest, 0));
  $('cups').textContent = `あと${cupsLeft(rest, doseG)}杯（1杯${formatG(doseG)}）`;
  $('stockParts').textContent = parts.frozenCount ? stockPartsText(parts) : '';
  const pace = consumptionPace(txs);
  const fc = emptyForecast(rest, pace);
  if (rest <= 0) {
    $('forecast').textContent = bean.status === 'finished' ? '' : '残りがなくなりました。飲み切りにしておくと一覧がすっきりします。';
  } else if (fc) {
    $('forecast').textContent = `この2週間のペース（1日${formatG(pace.gPerDay)}）だと、あと${fc.days}日（${formatDateTimeJa(fc.date).slice(5, 10)}ごろ）でなくなります`;
  } else {
    $('forecast').textContent = 'なくなる日の目安は、2週間で2杯以上淹れると表示します';
  }
  const inbound = txs.find((t) => t.kind === 'in');
  const measured = txs.some((t) => t.kind === 'adjust');
  $('estimateNote').textContent = inbound?.memo && !measured ? `入庫の量は${inbound.memo}です。届いた豆を量って「量り直す」で合わせると正確になります。` : '';
}

function renderTxList(txs) {
  const sorted = sortTxNewestFirst(txs);
  if (!sorted.length) {
    $('txList').replaceChildren(el('li', { class: 'muted' }, 'まだ履歴がありません'));
    return;
  }
  $('txList').replaceChildren(
    ...sorted.map((t) =>
      el(
        'li',
        {},
        el(
          'div',
          { class: 'tx-main' },
          el('span', { class: 'tx-kind' }, TX_KINDS[t.kind] ?? t.kind),
          el('span', { class: `num ${t.deltaG < 0 ? 'minus' : 'plus'}` }, `${t.deltaG > 0 ? '+' : ''}${formatG(t.deltaG)}`),
        ),
        el('div', { class: 'tx-sub muted' }, formatDateTimeJa(t.at), t.memo ? `　${t.memo}` : ''),
        t.kind !== 'in' &&
          el(
            'button',
            {
              class: 'link-btn',
              type: 'button',
              onclick: async () => {
                const extra = { freeze: '（作った袋も消えます）', thaw: '（袋は冷凍庫に戻ります）' }[t.kind] ?? '';
                if (!confirm(`「${TX_KINDS[t.kind] ?? t.kind} ${formatG(t.deltaG)}」を取り消しますか？${extra}`)) return;
                try {
                  await deleteInventoryTx(db, t.id);
                } catch (err) {
                  showMessage(err.message, 'error');
                  return;
                }
                showMessage('取り消しました');
                await render();
              },
            },
            '取り消す',
          ),
      ),
    ),
  );
}

function renderInfo(bean) {
  const rows = [
    ['焙煎度', bean.roastLevel],
    ['焙煎日', formatYmdJa(bean.roastDate, { withYear: true })],
    ['表記重量', bean.labelWeightG ? `${formatG(bean.labelWeightG)}（${WEIGHT_BASIS[bean.labelWeightBasis] ?? ''}）` : ''],
    ['実重量', bean.actualWeightG ? formatG(bean.actualWeightG) : ''],
    ['価格', bean.priceJpy != null ? `${bean.priceJpy.toLocaleString('ja-JP')}円` : ''],
    ['購入先', bean.shop],
    ['産地', originText(bean)],
    ['品種', bean.variety],
    ['精製', bean.process],
    ['注文日', formatYmdJa(bean.orderDate, { withYear: true })],
    ['到着日', formatYmdJa(bean.arrivalDate, { withYear: true })],
    ['状態', BEAN_STATUS[bean.status]],
    ['店の風味説明', bean.flavorNotes],
    ['メモ', bean.memo],
  ].filter(([, v]) => v);
  $('info').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  const url = bean.productUrl;
  $('orderRow').hidden = !/^https?:\/\//i.test(url ?? '');
  if (!$('orderRow').hidden) $('orderLink').href = url;
}

async function render() {
  const found = await getBeanWithTx(db, beanId ?? '');
  if (!found) {
    $('content').hidden = true;
    $('notFound').hidden = false;
    return;
  }
  const { bean, txs, portions } = found;
  doseG = doseFromSettings(await getSettings(db));
  if (!$('cupDose').value) $('cupDose').value = String(doseG);
  const inFreezer = portionsOf(portions, bean.id);
  const parts = stockParts(remainingG(txs), inFreezer);

  document.title = `${bean.name} - Pourfolio`;
  $('name').textContent = bean.name;
  $('sub').textContent = [bean.roastLevel, originText(bean)].filter(Boolean).join('　');
  $('editLink').href = `bean-edit.html?id=${encodeURIComponent(bean.id)}`;
  $('toggleFinished').textContent = bean.status === 'finished' ? '飲み切りを取り消す' : '飲み切りにする';
  $('toggleFinished').dataset.status = bean.status;
  // 入荷待ちの豆は、届くまで飲み頃・残量・在庫の操作を出さず「届いた」の入力だけにする
  const ordered = bean.status === 'ordered';
  for (const id of ['freshCard', 'stockCard', 'frozenCard', 'actions', 'txCard', 'toggleFinished']) $(id).hidden = ordered;
  $('arrivalCard').hidden = !ordered;
  if (ordered) {
    await renderArrival(bean);
  } else {
    renderFreshness(bean, parts);
    renderStock(bean, txs, parts);
    renderFrozen(inFreezer, parts);
    renderTxList(txs);
  }
  renderInfo(bean);
  $('content').hidden = false;
}

// ---- 冷凍ストック（C4） ----

const fz = {};
let roomG = 0;

/** 冷凍の入力欄（±ボタン付き）を一度だけ作る */
function buildFreezeForm() {
  if (fz.grams) return;
  const make = (box, opts) => {
    const f = stepperField({ ...opts, onValue: renderFreezeTotal });
    $(box).replaceChildren(f.node);
    return f;
  };
  fz.grams = make('fzGramsBox', { id: 'fzGrams', label: '1袋の量', unit: 'g', step: 1, decimals: 1, min: 1, max: 1000, errorFor: 'gramsPerPortion' });
  fz.count = make('fzCountBox', { id: 'fzCount', label: '袋の数', unit: '袋', step: 1, decimals: 0, min: 1, max: MAX_PORTIONS, errorFor: 'count' });
}

function readFreezeForm() {
  return { gramsPerPortion: fz.grams.input.value, count: fz.count.input.value, frozenDate: $('fzDate').value };
}

function renderFreezeTotal() {
  const g = parseNumber(fz.grams.input.value);
  const n = parseNumber(fz.count.input.value);
  const total = g > 0 && n > 0 ? Math.round(g * n * 10) / 10 : null;
  $('fzTotal').textContent = total != null ? `合計 ${formatG(total)}（常温の残り ${formatG(roomG)}）` : `常温の残り ${formatG(roomG)}`;
}

function renderFrozen(inFreezer, parts) {
  roomG = parts.roomG;
  buildFreezeForm();
  $('frozenSummary').textContent = inFreezer.length
    ? `冷凍庫に${inFreezer.length}袋（${formatG(parts.frozenG)}）あります。古い袋から使いましょう。`
    : '冷凍している袋はありません。';
  $('portionList').replaceChildren(
    ...inFreezer.map((p) =>
      el(
        'li',
        {},
        el(
          'div',
          { class: 'tx-main' },
          el('span', { class: 'tx-kind' }, portionText(p)),
          el(
            'button',
            {
              class: 'btn secondary small',
              type: 'button',
              onclick: async () => {
                await takeOutPortion(db, p.id);
                showMessage(`#${p.labelNo}（${formatG(p.grams)}）を取り出し、常温に戻しました`, 'ok', 'fzMsg');
                await render();
              },
            },
            '取り出す',
          ),
        ),
      ),
    ),
  );
  // 初期値：1袋＝1杯分、袋の数＝常温の残りで作れるだけ（最大10袋）
  if (!fz.grams.input.value) fz.grams.set(doseG);
  if (!fz.count.input.value || document.activeElement !== fz.count.input) {
    const g = parseNumber(fz.grams.input.value) || doseG;
    fz.count.set(Math.max(1, Math.min(10, Math.floor(roomG / g + 1e-9))));
  }
  if (!$('fzDate').value) $('fzDate').value = localYmd();
  $('freezeDetails').hidden = roomG <= 0;
  renderFreezeTotal();
}

$('freezeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const { value, errors } = normalizeFreezeInput(readFreezeForm(), { availableG: roomG });
  for (const span of event.target.querySelectorAll('.field-error')) span.textContent = errors[span.dataset.for] ?? '';
  if (!value) return;
  try {
    const { portions } = await freezeBean(db, beanId, value);
    showMessage(`${value.count}袋（${formatG(value.totalG)}）を冷凍しました。袋に ${labelRange(portions.map((p) => p.labelNo))} と書いておきましょう`, 'ok', 'fzMsg');
  } catch (err) {
    showMessage(err.message, 'error', 'fzMsg');
    return;
  }
  $('freezeDetails').open = false;
  fz.count.input.value = '';
  await render();
});

/** 入荷待ち：注文日と、届く重さの目安 */
async function renderArrival(bean) {
  const est = initialStockG(bean, await listBeans(db));
  $('arrivalText').textContent = bean.orderDate
    ? `${formatYmdJa(bean.orderDate)}に注文しました。届いたら、豆の重さを量って入れてください。`
    : '届いたら、豆の重さを量って入れてください。';
  $('arrivalHint').textContent =
    est && bean.labelWeightG
      ? `目安：${WEIGHT_BASIS[bean.labelWeightBasis] ?? ''}${formatG(bean.labelWeightG)} → 約${formatG(est.g)}`
      : '';
  if (!$('arrivalDate').value) $('arrivalDate').value = localYmd();
}

$('arrivalForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const raw = Object.fromEntries(new FormData(form));
  const { value, errors } = arrivalChanges(raw);
  for (const span of form.querySelectorAll('.field-error')) span.textContent = errors[span.dataset.for] ?? '';
  if (Object.keys(errors).length) return;
  await markArrived(db, beanId, value);
  form.reset();
  showMessage(`届いた豆を登録しました（${formatG(value.actualWeightG)}、焙煎日 ${formatYmdJa(value.roastDate)}）`);
  await render();
});

$('cupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const g = readGrams($('cupDose'), 100);
  if (g == null) return showMessage('粉の量は0より大きい数字（g）で入れてください', 'error');
  await recordCupUsage(db, beanId, g);
  showMessage(`${formatG(g)} 減らしました`);
  await render();
});

$('measureForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('measured');
  const g = parseNumber(input.value);
  if (g == null || Number.isNaN(g) || g < 0 || g > 5000) return showMessage('今の重さを0以上の数字（g）で入れてください', 'error');
  const tx = await measureBean(db, beanId, Math.round(g * 10) / 10);
  input.value = '';
  showMessage(tx ? `残量を ${formatG(g)} に合わせました（${tx.deltaG > 0 ? '+' : ''}${formatG(tx.deltaG)}）` : '残量と同じでした。変更はありません');
  await render();
});

$('outForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const g = readGrams($('outG'));
  if (g == null) return showMessage('減らす量を0より大きい数字（g）で入れてください', 'error');
  const kind = new FormData(event.target).get('outKind') === 'discard' ? 'discard' : 'gift';
  await addInventoryTx(db, { beanId, deltaG: -g, kind });
  $('outG').value = '';
  showMessage(`${TX_KINDS[kind]}で ${formatG(g)} 減らしました`);
  await render();
});

$('toggleFinished').addEventListener('click', async (event) => {
  const next = event.target.dataset.status === 'finished' ? 'open' : 'finished';
  await setBeanStatus(db, beanId, next);
  showMessage(next === 'finished' ? '飲み切りにしました' : '飲み切りを取り消しました');
  await render();
});

$('delete').addEventListener('click', async () => {
  if (!confirm('この豆と在庫の履歴を削除しますか？')) return;
  await deleteBean(db, beanId);
  location.replace('beans.html');
});

registerServiceWorker();
render().catch((err) => {
  console.error(err);
  showMessage('読み込みに失敗しました', 'error');
});
