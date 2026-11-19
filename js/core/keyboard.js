// キーボードが出たときに、入力している欄を見える所へ出すための計算（純粋関数、3.6.3、D-185）。
// iPhone の Safari はキーボードを出しても画面（レイアウト）の高さを変えず、見える範囲（visualViewport）だけを狭くする。
// ページ全体はスクロールしない作り（D-184）なので、中身の箱（main）を自分で動かす。動かすのは js/layout.js。

const NOT_TYPING = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file', 'color', 'hidden', 'image']);

/** キーボード（や選ぶ欄の回転式の部品）が出る欄か。{ tag, type, editable, readOnly }。読むだけの欄は出ない */
export function isTypingTarget({ tag, type = '', editable = false, readOnly = false } = {}) {
  if (readOnly) return false;
  const t = String(tag ?? '').toLowerCase();
  if (t === 'textarea' || t === 'select') return true;
  if (t === 'input') return !NOT_TYPING.has(String(type || 'text').toLowerCase());
  return !!editable;
}

// iPhone で、画面の下からキーボード（文字盤）が出るのではなく、欄の近くに小さな部品が出る欄（3.6.4、D-186）
const POPOVER_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week']);

/**
 * 画面の下から文字盤（キーボード）が出る欄か。選ぶ欄（select）と日付・時刻は、iPhone では欄の近くに部品が出るので含めない。
 * キーボードの高さが分からないときに見込みで動かす欄を決めるのに使う（3.6.4、D-186）
 */
export function opensKeyboard({ tag, type = '', editable = false, readOnly = false } = {}) {
  if (!isTypingTarget({ tag, type, editable, readOnly })) return false;
  const t = String(tag ?? '').toLowerCase();
  if (t === 'select') return false;
  if (t === 'input' && POPOVER_TYPES.has(String(type || 'text').toLowerCase())) return false;
  return true;
}

/**
 * キーボードの高さが分からないときの見込み（px）。ホーム画面のアプリでは、iPhone が見える範囲の変化をページに伝えないことがある
 * （ユーザーの画面写真、3.6.4）。縦向きは画面の半分（iPhone のかなのキーボードと上の「^ v ✓」の帯で 45% ほど）、横向きは 65%
 */
export function guessKeyboardInset({ innerHeight, innerWidth }) {
  if (!(innerHeight > 0)) return 0;
  return Math.round(innerHeight * (innerWidth > innerHeight ? 0.65 : 0.5));
}

/**
 * 画面の下の、キーボードに隠れている高さ（px）。拡大中（scale が 1 より大きい）は 0 として扱う
 * @param {{ innerHeight: number, vvHeight?: number, vvOffsetTop?: number, scale?: number }} v
 */
export function keyboardInset({ innerHeight, vvHeight, vvOffsetTop = 0, scale = 1 }) {
  if (!Number.isFinite(innerHeight) || !Number.isFinite(vvHeight)) return 0;
  if (scale > 1.01) return 0;
  const h = Math.round(innerHeight - vvHeight - vvOffsetTop);
  return h > 0 ? h : 0;
}

/**
 * 欄を見える範囲に入れるために、中身の箱をどれだけスクロールするか（正：下へ、負：上へ、0：動かさない）。
 * 位置はどれも画面（レイアウト）の上の端からの px。
 * @param {{ top: number, bottom: number }} field 欄（見出しを含めたい場合は、その上の端を top に）
 * @param {{ top: number, bottom: number }} visible 見える範囲（キーボードと下に付けるボタンを除いた所）
 * @param {number} margin 上下に空けたい余白
 */
export function revealDelta(field, visible, margin = 12) {
  const room = visible.bottom - visible.top;
  if (!(room > 0)) return 0;
  const h = field.bottom - field.top;
  // 欄が見える範囲より高いときは、欄の上の端を見せる（入力し始める所）
  if (h >= room) return Math.round(field.top - Math.min(margin, room / 4) - visible.top);
  const m = Math.max(0, Math.min(margin, (room - h) / 2));
  if (field.bottom + m > visible.bottom) return Math.round(field.bottom + m - visible.bottom);
  if (field.top - m < visible.top) return Math.round(field.top - m - visible.top);
  return 0;
}

/**
 * 見える範囲。下の端は、キーボードの上の端・中身の箱の下の端・（欄の上にかぶる）下に付けるボタンの上の端のいちばん上
 * @param {{ vvTop: number, vvBottom: number, boxTop: number, boxBottom: number, barTop?: number|null }} v
 */
export function visibleArea({ vvTop, vvBottom, boxTop, boxBottom, barTop = null }) {
  const top = Math.max(vvTop, boxTop);
  let bottom = Math.min(vvBottom, boxBottom);
  if (barTop != null && barTop > top && barTop < bottom) bottom = barTop;
  return { top, bottom };
}
