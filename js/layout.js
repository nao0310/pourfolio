// 画面の作り（D-184）の見張り。ページ全体はスクロールさせず、中身（main）だけをスクロールする（css/base.css の終わり）。
// - iPhone はキーボードを出すと、ページ全体を上へずらすことがある。閉じたあとも戻らないと、下のタブが上に浮いて見えるため、
//   入力が終わったとき・画面の大きさが変わったときに、ずれていればページ全体を元の位置に戻す
// - 中身の箱でスクロールするとブラウザは「戻る」のときの位置を覚えないので、画面ごとに覚えて戻す（同じタブの中だけ、sessionStorage）
// - 入力中（キーボードが出ている間）はページ全体のずれを戻さない（Safari が欄を見せるために動かした分を打ち消さないため）。
//   代わりに、中身の箱の下にキーボードの高さ分の余白を足し、欄が見える所まで中身の箱を動かす（3.6.3、D-185。計算は js/core/keyboard.js）
// registerServiceWorker（js/pwa.js → js/page-life.js）から全画面で呼ばれる。
import { isTypingTarget, keyboardInset, revealDelta, visibleArea } from './core/keyboard.js';

const KEY = 'pourfolio.scroll';

/** 中身の箱（main）。なければページ全体 */
export function scroller() {
  return document.querySelector('main') ?? document.scrollingElement ?? document.documentElement;
}

/** 中身をいちばん上に戻す（window.scrollTo の代わり） */
export function scrollToTop() {
  scroller().scrollTo(0, 0);
}

/** ページ全体がずれていたら戻す */
export function resetDocumentOffset() {
  if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
}

/** キーボード（や選ぶ欄の部品）が出る欄にカーソルがあるか */
export function isTyping(el = document.activeElement) {
  if (!el || el === document.body || el === document.documentElement) return false;
  return isTypingTarget({ tag: el.tagName, type: el.getAttribute?.('type') ?? '', editable: !!el.isContentEditable });
}

/** 画面の下の、キーボードに隠れている高さ（px） */
function currentInset() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return keyboardInset({ innerHeight: window.innerHeight, vvHeight: vv.height, vvOffsetTop: vv.offsetTop, scale: vv.scale });
}

/** 中身の箱の下に、キーボードの高さ分の余白を付ける・外す（css/base.css の main.kb-open::after） */
function setKeyboardRoom(px) {
  const box = document.querySelector('main');
  if (!box) return;
  box.classList.toggle('kb-open', px > 0);
  if (px > 0) box.style.setProperty('--kb', `${px}px`);
  else box.style.removeProperty('--kb');
}

/** 入力中の欄（見出しを含む）が、キーボードと下に付けるボタンに隠れないように中身の箱を動かす */
export function revealFocused() {
  const el = document.activeElement;
  const box = document.querySelector('main');
  if (!box || !isTyping(el) || !box.contains(el)) return;
  setKeyboardRoom(currentInset());
  const vv = window.visualViewport;
  // 動かすと下に付けるボタンの位置も変わるので、何度か測り直す
  for (let i = 0; i < 3; i++) {
    const r = el.getBoundingClientRect();
    if (!r.height) return;
    const b = box.getBoundingClientRect();
    const vvTop = vv ? vv.offsetTop : 0;
    const vvBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    let barTop = null;
    for (const bar of box.querySelectorAll('.bottom-bar')) {
      if (bar.contains(el)) continue;
      const br = bar.getBoundingClientRect();
      if (br.height && br.bottom > vvTop && (barTop == null || br.top < barTop)) barTop = br.top;
    }
    const vis = visibleArea({ vvTop, vvBottom, boxTop: b.top, boxBottom: b.bottom, barTop });
    // 見出し（.field や label の上の端）も入るなら一緒に見せる
    let top = r.top;
    const holder = el.closest('.field, label');
    if (holder && holder !== el) {
      const h = holder.getBoundingClientRect().top;
      if (h < r.top && r.bottom - h <= vis.bottom - vis.top - 24) top = h;
    }
    const d = revealDelta({ top, bottom: r.bottom }, vis);
    if (!d) return;
    const before = box.scrollTop;
    box.scrollTop = before + d;
    if (box.scrollTop === before) return;
  }
}

function readAll() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

let started = false;
export function watchLayout() {
  if (started) return;
  started = true;
  // 入力をやめたとき：次の欄に移ったのでなければ、キーボードの分の余白を外し、ページ全体のずれを戻す
  const settle = () => {
    if (isTyping()) return;
    setKeyboardRoom(0);
    resetDocumentOffset();
  };
  let timer = 0;
  // 画面の大きさが変わったとき：入力中なら欄を見せ直す（キーボードが閉じていればずれも戻す）。入力中でなければずれを戻す
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!isTyping()) return settle();
      if (currentInset() === 0) resetDocumentOffset();
      revealFocused();
    }, 60);
  };
  document.addEventListener('focusin', (e) => {
    if (!isTyping(e.target)) return;
    requestAnimationFrame(revealFocused);
    // キーボードが出きるのを待って、もう一度（見える範囲の resize が来ない場合のため）
    setTimeout(revealFocused, 400);
  });
  document.addEventListener('focusout', () => setTimeout(settle, 50));
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  window.addEventListener('pageshow', () => setTimeout(settle, 50));
  // 「戻る」のための位置を覚える・戻す
  const here = location.pathname + location.search;
  window.addEventListener('pagehide', () => {
    try {
      const all = readAll();
      all[here] = Math.round(scroller().scrollTop);
      sessionStorage.setItem(KEY, JSON.stringify(all));
    } catch {}
  });
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  // 「戻る」のとき（bfcache から戻って読み直したときは reload になる、D-178）
  if (nav?.type === 'back_forward' || nav?.type === 'reload') {
    const y = readAll()[here];
    if (y > 0) {
      // 中身を描き終えるのを少し待ってから戻す
      let tries = 0;
      const restore = () => {
        const el = scroller();
        if (el.scrollHeight - el.clientHeight >= y || tries++ > 20) el.scrollTop = y;
        else setTimeout(restore, 100);
      };
      setTimeout(restore, 50);
    }
  }
}
