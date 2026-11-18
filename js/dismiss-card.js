// お知らせのカードに「×（閉じる）」を付けて出す（2-8 の2番）。
// 閉じたことはこのブラウザの localStorage に覚える（下書きと同じ置き場所、書き出しには入れない）。
// いつまた出すかは js/core/dismiss.js の DISMISS_RULES。
import { dismiss, dismissKey, isDismissed, prune, DISMISS_RULES } from './core/dismiss.js';
import { el } from './ui.js';

const KEY = 'pourfolio.dismissed';

function load() {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

function save(memo) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prune(memo)));
  } catch {
    /* 使えない環境では覚えない（次に開いたときにまた出る） */
  }
}

/** 閉じたことを短く知らせる（5秒で消える） */
function notice(card, kind) {
  const p = el('p', { class: 'muted dismiss-note', role: 'status' }, `お知らせを閉じました。${DISMISS_RULES[kind].label}`);
  card.before(p);
  setTimeout(() => p.remove(), 5000);
}

/**
 * カードを出す。閉じてあるなら出さない。
 * カードの中の [data-dismiss] の付いたボタン（例：「今回はしない」）も、× と同じく閉じる。
 * @param {HTMLElement} card
 * @param {string} kind DISMISS_RULES の名前
 * @param {string|number|null} [part] その杯のIDや中身の目印
 * @returns {boolean} 出したか
 */
export function showCard(card, kind, part = null) {
  const key = dismissKey(kind, part);
  if (isDismissed(load(), key)) {
    card.hidden = true;
    return false;
  }
  let btn = card.querySelector(':scope > .card-close');
  if (!btn) {
    btn = el('button', { class: 'card-close', type: 'button', 'aria-label': 'このお知らせを閉じる' }, '×');
    card.prepend(btn);
    card.classList.add('closable');
  }
  const close = () => {
    save(dismiss(load(), key));
    card.hidden = true;
    notice(card, kind);
  };
  btn.onclick = close;
  for (const b of card.querySelectorAll('[data-dismiss]')) b.onclick = close;
  card.hidden = false;
  return true;
}
