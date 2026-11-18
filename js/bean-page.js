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
  unfinishBean,
  deleteBean,
  listBeans,
  markArrived,
  freezeBean,
  takeOutPortion,
  listExperiments,
  listBrews,
  listTastings,
  listRecipes,
  listEquipment,
} from './db.js';
import { initialRecipe, baseRecipe, initialText, INITIAL_SOURCES } from './core/initial-recipe.js';
import { defaultEquipmentIds } from './core/equipment.js';
import { normalizeFreezeInput, portionsOf, stockParts, stockPartsText, portionText, labelRange, MAX_PORTIONS } from './core/frozen.js';
import { arrivalChanges } from './core/orders.js';
import { initialStockG } from './core/roast.js';
import { canisterUrl } from './core/scan-target.js';
import { qrSvg } from './core/qr-code.js';
import { originText, BEAN_STATUS, WEIGHT_BASIS, parseNumber } from './core/beans.js';
import { gramPrice, yen, yenPerGText } from './core/cost.js';
import { remainingG, cupsLeft, consumptionPace, emptyForecast, doseFromSettings, sortTxNewestFirst, TX_KINDS } from './core/inventory.js';
import { freshness, FRESHNESS_WINDOWS, FALLBACK_GROUP, STAGES } from './core/freshness.js';
import { roastGroup, ROAST_GROUPS } from './core/roast.js';
import { localYmd, formatYmdJa, formatG, formatDateTimeJa, formatDateJa } from './core/format.js';
import { roastPreferences, preferenceForBean, preferenceText } from './core/compare.js';
import { $, el, queryParam, showMessage, freshnessPill, frozenPill, stepperField, svgElement } from './ui.js';
import { registerServiceWorker } from './pwa.js';
import { showCard } from './dismiss-card.js';
import { singleFlight } from './core/once.js';
import { askConfirm } from './confirm-box.js';

/**
 * 送信の処理を、終わるまで2回目を受け付けない形にする（2-8 の13番：冷凍する・1杯淹れたなどの2度押しで2件できないように）。
 * 処理中は送信ボタンを押せなくし、失敗したら赤い文で知らせる
 */
function guarded(handler, msgId) {
  const run = singleFlight(async (event, form) => {
    const buttons = [...form.querySelectorAll('button[type="submit"]')];
    buttons.forEach((b) => (b.disabled = true));
    try {
      await handler(event);
    } catch (err) {
      console.error(err);
      showMessage(err?.message ? `できませんでした：${err.message}` : 'できませんでした。もう一度押してください', 'error', msgId);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
  // 処理中の2回目でも、ブラウザの送信（画面の読み直し）は必ず止める
  return (event) => {
    event.preventDefault();
    run(event, event.currentTarget);
  };
}

const db = openDb();
const beanId = queryParam('id');
let doseG = 15;

/** 数字の入力を読む（0より大きく、上限以下） */
function readGrams(input, max = 5000) {
  const g = parseNumber(input.value);
  if (g == null || Number.isNaN(g) || g <= 0 || g > max) return null;
  return Math.round(g * 10) / 10;
}

/**
 * 飲み頃の帯：4段階を横に並べ、今日の位置に印を付ける。
 * 段階の名前は帯の中に入れると幅320・375で切れるので、帯の下に色の印と並べる（2-8の27番）
 */
function renderBand(f, group) {
  const w = FRESHNESS_WINDOWS[group];
  const total = w.pastUntil + 8; // 「早めに消費」も少し見せる
  const seg = (stage, from, to) => el('span', { class: `seg stage-${stage}`, style: `flex-grow:${to - from}` });
  $('bandLegend').replaceChildren(
    ...['resting', 'peak', 'past', 'useSoon'].map((stage) => el('span', { class: 'band-key' }, el('span', { class: `band-dot stage-${stage}` }), STAGES[stage])),
  );
  const children = [
    seg('resting', 0, w.restUntil + 1),
    seg('peak', w.restUntil + 1, w.peakUntil + 1),
    seg('past', w.peakUntil + 1, w.pastUntil + 1),
    seg('useSoon', w.pastUntil + 1, total),
  ];
  if (f) {
    // 印が帯の端からはみ出さないよう、端から3px内側に収める
    const pos = Math.min(Math.max(f.days + 0.5, 0), total) / total;
    children.push(el('span', { class: 'band-marker', style: `left:clamp(3px, ${(pos * 100).toFixed(1)}%, calc(100% - 3px))` }));
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
    $('forecast').textContent = `この2週間のペース（1日${formatG(pace.gPerDay)}）だと、あと${fc.days}日（${formatDateJa(fc.date)}ごろ）でなくなります`;
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
          !(t.kind === 'thaw' && t.brewId) && // 抽出で使った袋の取り出しは取り消せない（2-8 の9番）
          el(
            'button',
            {
              class: 'link-btn',
              type: 'button',
              onclick: async () => {
                const extra = { freeze: '（作った袋も消えます）', thaw: '（袋は冷凍庫に戻ります）' }[t.kind] ?? '';
                if (!(await askConfirm(`「${TX_KINDS[t.kind] ?? t.kind} ${formatG(t.deltaG)}」を取り消しますか？${extra}`, { ok: '取り消す' }))) return;
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

function renderInfo(bean, allBeans) {
  // コスト（C6）：1gあたりの値段と1杯の原価
  const gp = gramPrice(bean, allBeans);
  const rows = [
    ['焙煎度', bean.roastLevel],
    ['焙煎日', formatYmdJa(bean.roastDate, { withYear: true })],
    ['表記重量', bean.labelWeightG ? `${formatG(bean.labelWeightG)}（${WEIGHT_BASIS[bean.labelWeightBasis] ?? ''}）` : ''],
    ['実重量', bean.actualWeightG ? formatG(bean.actualWeightG) : ''],
    ['価格', bean.priceJpy != null ? `${bean.priceJpy.toLocaleString('ja-JP')}円` : ''],
    ['1gあたり', yenPerGText(gp)],
    ['1杯の原価', gp ? `約${yen(gp.yenPerG * doseG)}（1杯${formatG(doseG)}）` : ''],
    ['購入先', bean.shop],
    ['産地', originText(bean)],
    ['品種', bean.variety],
    ['精製', bean.process],
    ['注文日', formatYmdJa(bean.orderDate, { withYear: true })],
    ['到着日', formatYmdJa(bean.arrivalDate, { withYear: true })],
    ['状態', BEAN_STATUS[bean.status]],
    ['カフェイン', bean.decaf ? 'カフェインレス' : ''],
    ['店の風味説明', bean.flavorNotes],
    ['メモ', bean.memo],
  ].filter(([, v]) => v);
  $('info').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  const url = bean.productUrl;
  $('orderRow').hidden = !/^https?:\/\//i.test(url ?? '');
  if (!$('orderRow').hidden) $('orderLink').href = url;
}

/**
 * 新しい豆の初期レシピ（F2）：まだ淹れていない豆（手元にあるもの）だけに出す
 */
async function renderInitial(bean, allBeans) {
  const [brews, tastings, recipes, equipment, settings] = await Promise.all([listBrews(db), listTastings(db), listRecipes(db), listEquipment(db), getSettings(db)]);
  const show = bean.status !== 'ordered' && bean.status !== 'finished' && !brews.some((b) => b.beanId === bean.id);
  $('initCard').hidden = true;
  if (!show || !showCard($('initCard'), 'init', bean.id)) return;
  const recipe = baseRecipe(recipes, brews);
  const grinderId = recipe?.grind?.grinderId ?? defaultEquipmentIds(equipment).grinderId;
  const init = initialRecipe({ bean, beans: allBeans, brews, tastings, grinders: equipment.filter((e) => e.kind === 'grinder'), grinderId, defaultDoseG: doseFromSettings(settings) });
  $('initSource').textContent = INITIAL_SOURCES[init.source];
  $('initText').textContent = initialText(init);
  $('initReasons').replaceChildren(...init.reasons.map((t) => el('li', {}, t)));
  const id = encodeURIComponent(bean.id);
  $('initBrew').href = `brew.html?initial=${id}&bean=${id}`;
}

/** 焙煎度比較（X27）でわかった、この豆の産地の好きな焙煎度 */
async function renderRoastPref(bean, allBeans) {
  const pref = preferenceForBean(roastPreferences(await listExperiments(db), allBeans), bean);
  const text = preferenceText(pref);
  $('roastPref').hidden = !text;
  $('roastPref').textContent = text ? `${text}。次の注文は「${pref.best}」がおすすめです` : '';
  $('roastPrefNote').hidden = Boolean(text);
  $('compareLink').href = `compare.html?bean=${encodeURIComponent(bean.id)}`;
}

/** キャニスターの QR（X14）。開いたときだけ作る */
function renderCanister(bean) {
  $('canisterCard').hidden = bean.status === 'ordered';
  $('canisterPrint').href = `recipe-card.html?canister=${encodeURIComponent(bean.id)}`;
  $('canisterDetails').ontoggle = () => {
    if (!$('canisterDetails').open || $('canisterQr').childElementCount) return;
    const url = canisterUrl(new URL('./', location.href).href, bean.id);
    $('canisterQr').replaceChildren(svgElement(qrSvg(url, { label: `${bean.name}のキャニスター用QR` })));
  };
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
  renderMainAction(bean);
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
  const allBeans = await listBeans(db);
  renderInfo(bean, allBeans);
  await renderInitial(bean, allBeans);
  await renderRoastPref(bean, allBeans);
  renderCanister(bean);
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
              onclick: singleFlight(async (ev) => {
                ev.currentTarget.disabled = true; // 2度押しで「冷凍庫にない袋です」にならないように（2-8 の13番）
                try {
                  await takeOutPortion(db, p.id);
                } catch (err) {
                  console.error(err);
                  showMessage(err.message, 'error', 'fzMsg');
                  ev.currentTarget.disabled = false;
                  return;
                }
                showMessage(`#${p.labelNo}（${formatG(p.grams)}）を取り出し、常温に戻しました`, 'ok', 'fzMsg');
                await render();
              }),
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

$('freezeForm').addEventListener('submit', guarded(async (event) => {
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
}, 'fzMsg'));

/**
 * 画面の下に固定するボタン（2-8 の20番）：その豆でいちばん使う操作
 * - 入荷待ち：「届いた」（入力欄へ移って重さを入れる）
 * - 手元にある豆：「この豆で淹れる」（★がいちばん高かった淹れ方。まだなければ最初のレシピ）
 * - 飲み切り：出さない
 */
function renderMainAction(bean) {
  const btn = $('mainAction');
  const show = bean.status !== 'finished';
  $('bottomBar').hidden = !show;
  document.querySelector('main').classList.toggle('with-bottom-bar', show);
  if (!show) return;
  if (bean.status === 'ordered') {
    btn.textContent = '届いた';
    btn.removeAttribute('href');
    btn.setAttribute('role', 'button');
    // 重さが入っていれば「届いた」を送る。まだなら重さの欄へ移る
    btn.onclick = () => {
      if ($('arrivalWeight').value.trim()) {
        $('arrivalForm').requestSubmit();
        return;
      }
      $('arrivalCard').scrollIntoView({ block: 'start', behavior: 'smooth' });
      $('arrivalWeight').focus({ preventScroll: true });
    };
  } else {
    btn.textContent = 'この豆で淹れる';
    btn.removeAttribute('role');
    btn.onclick = null;
    btn.href = `brew.html?best=${encodeURIComponent(bean.id)}`;
  }
}

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

$('arrivalForm').addEventListener('submit', guarded(async (event) => {
  const form = event.target;
  const raw = Object.fromEntries(new FormData(form));
  const { value, errors } = arrivalChanges(raw);
  for (const span of form.querySelectorAll('.field-error')) span.textContent = errors[span.dataset.for] ?? '';
  if (Object.keys(errors).length) return;
  await markArrived(db, beanId, value);
  form.reset();
  showMessage(`届いた豆を登録しました（${formatG(value.actualWeightG)}、焙煎日 ${formatYmdJa(value.roastDate)}）`);
  await render();
}));

$('cupForm').addEventListener('submit', guarded(async () => {
  const g = readGrams($('cupDose'), 100);
  if (g == null) return showMessage('粉の量は0より大きい数字（g）で入れてください', 'error');
  await recordCupUsage(db, beanId, g);
  showMessage(`${formatG(g)} 減らしました`);
  await render();
}));

$('measureForm').addEventListener('submit', guarded(async () => {
  const input = $('measured');
  const g = parseNumber(input.value);
  if (g == null || Number.isNaN(g) || g < 0 || g > 5000) return showMessage('今の重さを0以上の数字（g）で入れてください', 'error');
  const tx = await measureBean(db, beanId, Math.round(g * 10) / 10);
  input.value = '';
  showMessage(tx ? `残量を ${formatG(g)} に合わせました（${tx.deltaG > 0 ? '+' : ''}${formatG(tx.deltaG)}）` : '残量と同じでした。変更はありません');
  await render();
}));

$('outForm').addEventListener('submit', guarded(async (event) => {
  const g = readGrams($('outG'));
  if (g == null) return showMessage('減らす量を0より大きい数字（g）で入れてください', 'error');
  const kind = new FormData(event.target).get('outKind') === 'discard' ? 'discard' : 'gift';
  await addInventoryTx(db, { beanId, deltaG: -g, kind });
  $('outG').value = '';
  showMessage(`${TX_KINDS[kind]}で ${formatG(g)} 減らしました`);
  await render();
}));

$('toggleFinished').addEventListener('click', async (event) => {
  const finishing = event.target.dataset.status !== 'finished';
  if (finishing) await setBeanStatus(db, beanId, 'finished');
  else await unfinishBean(db, beanId);
  showMessage(finishing ? '飲み切りにしました' : '飲み切りを取り消しました');
  await render();
});

$('delete').addEventListener('click', async () => {
  if (!(await askConfirm('この豆と在庫の履歴を削除しますか？元に戻せません', { ok: '削除する', danger: true }))) return;
  await deleteBean(db, beanId);
  location.replace('beans.html');
});

registerServiceWorker();
render().catch((err) => {
  console.error(err);
  showMessage('読み込みに失敗しました', 'error');
});
