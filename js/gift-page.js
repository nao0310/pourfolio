// おすそ分け（X34）：相手ごとの合計と、渡した記録。もらった感想をあとから書く
import { openDb, listAliveTx, listBeans, setGiftFeedback } from './db.js';
import { giftRows, giftTotals, normalizeFeedback, FEEDBACK_MAX } from './core/gift.js';
import { formatDateJa, formatG } from './core/format.js';
import { $, el, showToast } from './ui.js';
import { registerServiceWorker } from './pwa.js';
import { singleFlight } from './core/once.js';

const db = openDb();

function totalsCard(totals) {
  return el(
    'section',
    { class: 'card' },
    el('h2', {}, '相手ごと'),
    el(
      'ul',
      { class: 'tx-list' },
      ...totals.map((t) =>
        el(
          'li',
          {},
          el('div', { class: 'tx-main' }, el('span', { class: 'tx-kind' }, t.name), el('span', { class: 'num' }, formatG(t.totalG))),
          el(
            'div',
            { class: 'tx-sub muted' },
            [`${t.count}回`, `最後 ${formatDateJa(t.lastAt)}`, t.feedbacks ? `感想${t.feedbacks}件` : ''].filter(Boolean).join('・'),
          ),
          el('div', { class: 'tx-sub muted' }, t.beans.join('、')),
        ),
      ),
    ),
  );
}

/** 感想を書く欄（開いたときだけ作る） */
function feedbackForm(row) {
  const area = el('textarea', { rows: 3, maxlength: String(FEEDBACK_MAX), 'aria-label': '感想', placeholder: '例：酸味が爽やかでおいしかったって。浅めが好きらしい' });
  area.value = row.feedback;
  const save = singleFlight(async () => {
    const { value, error } = normalizeFeedback(area.value);
    if (error) return showToast(error, 'error');
    try {
      await setGiftFeedback(db, row.tx.id, value);
    } catch (err) {
      console.error(err);
      return showToast(err?.message ? `保存できませんでした：${err.message}` : '保存できませんでした', 'error');
    }
    showToast(value ? '感想を保存しました' : '感想を消しました');
    await render();
  });
  return el(
    'form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        save();
      },
    },
    el('label', { class: 'field' }, area),
    el('button', { class: 'btn secondary', type: 'submit' }, '感想を保存'),
  );
}

function giftItem(row) {
  const head = [formatDateJa(row.at), row.recipient ? `→ ${row.recipient}` : ''].filter(Boolean).join('　');
  const details = el('details', { class: 'sub-action' }, el('summary', {}, row.feedback ? '感想を直す' : 'もらった感想を書く'));
  details.addEventListener('toggle', () => {
    if (details.open && details.childElementCount === 1) details.append(feedbackForm(row));
  });
  return el(
    'li',
    {},
    el(
      'div',
      { class: 'tx-main' },
      el('span', { class: 'tx-kind' }, row.beanName),
      el('span', { class: 'num' }, formatG(row.g)),
    ),
    el('div', { class: 'tx-sub muted' }, head),
    row.memo ? el('div', { class: 'tx-sub muted' }, row.memo) : null,
    row.feedback ? el('p', { class: 'gift-feedback' }, `感想：${row.feedback}`) : null,
    details,
  );
}

async function render() {
  const [txs, beans] = await Promise.all([listAliveTx(db), listBeans(db)]);
  const rows = giftRows({ txs, beans });
  if (!rows.length) {
    $('content').replaceChildren(
      el(
        'section',
        { class: 'card' },
        el('p', {}, 'まだおすそ分けの記録がありません。'),
        el('p', { class: 'muted' }, '豆の画面の「おすそ分け・廃棄」で、渡した相手と量を入れると、ここに並びます。'),
        el('p', {}, el('a', { class: 'btn block', href: 'beans.html' }, '豆の一覧へ')),
      ),
    );
    return;
  }
  const total = Math.round(rows.reduce((s, r) => s + r.g, 0) * 10) / 10;
  $('content').replaceChildren(
    el('p', { class: 'num' }, `これまでに${rows.length}回・${formatG(total)}`),
    totalsCard(giftTotals(rows)),
    el('section', { class: 'card' }, el('h2', {}, '渡した記録'), el('ul', { class: 'tx-list' }, ...rows.map(giftItem))),
  );
}

registerServiceWorker();
render().catch((err) => {
  console.error(err);
  $('content').replaceChildren(el('p', { class: 'error' }, '読み込めませんでした。開き直してください'));
});
