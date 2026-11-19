// 豆の一覧（C1〜C3）
import { openDb, listBeans, listAliveTx, listFrozenPortions, getSettings, updateSettings } from './db.js';
import { groupPortionsByBean, stockParts } from './core/frozen.js';
import { sortBeansForList, originText, BEAN_STATUS, parseNumber } from './core/beans.js';
import { groupTxByBean, remainingG, cupsLeft, doseFromSettings } from './core/inventory.js';
import { freshness } from './core/freshness.js';
import { localYmd, formatG, formatYmdJa } from './core/format.js';
import { $, el, showMessage, freshnessPill, frozenPill } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const SHOW_FINISHED_KEY = 'pourfolio.beans.showFinished';

function readShowFinished() {
  try {
    return localStorage.getItem(SHOW_FINISHED_KEY) === '1';
  } catch {
    return false;
  }
}

function beanCard(bean, txs, portions, doseG, today) {
  // 残量は常温＋冷凍の合計（C4）
  const parts = stockParts(remainingG(txs), portions);
  const rest = parts.totalG;
  const frozenOnly = parts.roomG <= 0 && parts.frozenCount > 0;
  const f = freshness(bean.roastDate, bean.roastLevel, today);
  const sub = [bean.roastLevel, originText(bean)].filter(Boolean).join('　');
  const daysText = frozenOnly ? '' : f ? (f.days >= 0 ? `焙煎から${f.days}日` : `焙煎まであと${-f.days}日`) : '';
  return el(
    'a',
    { class: `card bean-card${bean.status === 'finished' ? ' finished' : ''}`, href: `bean.html?id=${encodeURIComponent(bean.id)}` },
    el('div', { class: 'bean-card-top' }, el('span', { class: 'bean-name' }, bean.name), bean.status !== 'ordered' && (frozenOnly ? frozenPill() : freshnessPill(f))),
    sub && el('div', { class: 'muted' }, sub),
    bean.status === 'ordered'
      ? el(
          'div',
          { class: 'bean-card-stock' },
          el('span', { class: 'ordered-pill' }, '入荷待ち'),
          bean.orderDate && el('span', { class: 'muted' }, `${formatYmdJa(bean.orderDate)}に注文`),
        )
      : el(
          'div',
          { class: 'bean-card-stock' },
          el('span', { class: 'num' }, formatG(Math.max(rest, 0))),
          el('span', {}, `あと${cupsLeft(rest, doseG)}杯`),
          parts.frozenCount > 0 && el('span', { class: 'muted' }, `冷凍${parts.frozenCount}袋を含む`),
          daysText && el('span', { class: 'muted' }, daysText),
          bean.status !== 'open' && el('span', { class: 'muted' }, BEAN_STATUS[bean.status] ?? ''),
        ),
  );
}

async function render() {
  const [beans, txs, portions, settings] = await Promise.all([listBeans(db), listAliveTx(db), listFrozenPortions(db), getSettings(db)]);
  const portionsByBean = groupPortionsByBean(portions);
  const doseG = doseFromSettings(settings);
  if (document.activeElement !== $('dose')) $('dose').value = String(doseG);
  const byBean = groupTxByBean(txs);
  const today = localYmd();
  const showFinished = $('showFinished').checked;
  const sorted = sortBeansForList(beans);
  const finishedCount = sorted.filter((b) => b.status === 'finished').length;
  $('finishedCount').textContent = finishedCount ? `（${finishedCount}）` : '';
  const shown = sorted.filter((b) => showFinished || b.status !== 'finished');

  const list = $('list');
  if (!shown.length) {
    list.replaceChildren(
      el(
        'div',
        { class: 'card empty' },
        // 0件のときは案内を1行だけにする（同じ案内が2行続かないように、総仕上げの86番）
        el('p', {}, beans.length ? '飲みかけの豆はありません。' : 'まだ豆はありません。下の「＋ 豆を登録する」から登録すると、ここに表示します。'),
        beans.length ? el('p', { class: 'muted' }, '下の「＋ 豆を登録する」から、届いた豆を登録してください。') : '',
      ),
    );
    return;
  }
  list.replaceChildren(...shown.map((b) => beanCard(b, byBean[b.id] ?? [], portionsByBean[b.id] ?? [], doseG, today)));
}

$('showFinished').checked = readShowFinished();
$('showFinished').addEventListener('change', () => {
  try {
    localStorage.setItem(SHOW_FINISHED_KEY, $('showFinished').checked ? '1' : '0');
  } catch {
    // 保存できなくても表示は切り替える
  }
  render();
});

$('doseForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const g = parseNumber($('dose').value);
  if (g == null || Number.isNaN(g) || g <= 0 || g > 100) {
    showMessage('1杯の粉の量は0より大きい数字（g）で入れてください', 'error', 'doseMsg');
    return;
  }
  await updateSettings(db, { defaultDoseG: Math.round(g * 10) / 10 });
  $('dose').blur();
  showMessage(`1杯 ${formatG(g)} で計算します`, 'ok', 'doseMsg');
  await render();
});

// 注文メールから登録して戻ってきたとき
const registered = Number(new URLSearchParams(location.search).get('registered'));
if (registered > 0) {
  $('registeredMsg').textContent = `${registered}袋を「入荷待ち」として登録しました。届いたら、豆を押して「届いた」で重さを入れてください`;
  $('registeredMsg').hidden = false;
  history.replaceState(null, '', 'beans.html');
}

registerServiceWorker();
render().catch((err) => {
  console.error(err);
  $('list').replaceChildren(el('p', { class: 'error' }, '豆を読み込めませんでした。開き直してください'));
});
