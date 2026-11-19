// 画面に戻ってきたときの読み直し（総仕上げの54・59番、D-178）。決め方は js/core/page-life.js
// registerServiceWorker（js/pwa.js）から全画面で呼ばれる。淹れている途中などは blockReturnReload で止める。
import { shouldReload, dayKey } from './core/page-life.js';

let blocker = () => false;
let started = false;

/** 読み直さない間の条件（淹れるタイマー中・入力の途中など） */
export function blockReturnReload(isBlocked) {
  blocker = isBlocked;
}

export function watchPageLife() {
  if (started) return;
  started = true;
  const loadedKey = dayKey(new Date());
  const reloadIf = (event, persisted) => {
    let blocked = false;
    try {
      blocked = !!blocker();
    } catch {}
    if (shouldReload({ event, persisted, pathname: location.pathname, loadedKey, now: new Date(), blocked })) location.reload();
  };
  window.addEventListener('pageshow', (e) => reloadIf('pageshow', e.persisted));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reloadIf('visible');
  });
}
