// 画面の作り（D-184）の見張り。ページ全体はスクロールさせず、中身（main）だけをスクロールする（css/base.css の終わり）。
// - iPhone はキーボードを出すと、ページ全体を上へずらすことがある。閉じたあとも戻らないと、下のタブが上に浮いて見えるため、
//   入力が終わったとき・画面の大きさが変わったときに、ずれていればページ全体を元の位置に戻す
// - 中身の箱でスクロールするとブラウザは「戻る」のときの位置を覚えないので、画面ごとに覚えて戻す（同じタブの中だけ、sessionStorage）
// registerServiceWorker（js/pwa.js → js/page-life.js）から全画面で呼ばれる。
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
  const fix = () => setTimeout(resetDocumentOffset, 50);
  document.addEventListener('focusout', fix);
  window.addEventListener('resize', fix);
  window.visualViewport?.addEventListener('resize', fix);
  window.addEventListener('pageshow', fix);
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
