// 下の5つのタブ（D-063・D-118）。タブそのものは各画面の HTML に書いてある（npm run sw が書き込む、2-8 の3番）。
// ここでは印を付けるだけ。HTML にタブがない古い画面（書き込み前）のときだけ、ここで足す。
// 抽出のタイマー中（body.timer-on）は CSS で隠す。
import { tabForPath, tabbarHtml } from './core/tabs.js';

function render() {
  const current = tabForPath(location.pathname);
  if (!current) return;
  if (!document.querySelector('nav.tabbar')) document.body.insertAdjacentHTML('beforeend', tabbarHtml(current));
  document.body.classList.add('has-tabbar');
}

render();
