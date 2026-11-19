// データの画面の「キーボードの点検」（3.6.4、D-186）。欄を押すと、iPhone がページに伝えている画面の高さ・見える範囲を出す。
// ホーム画面のアプリで、キーボードの高さが伝わっているかを確かめるため（この作業環境には Safari がなく、ここでは確かめられない）。
// 記録には残さず、外にも送らない。
import { keyboardState } from './layout.js';
import { isStandalone } from './pwa.js';

export function setupKeyboardCheck({ input, output }) {
  if (!input || !output) return;
  let lines = [];
  let minVv = Infinity;
  let started = 0;
  let timers = [];
  const read = (label) => {
    const vv = window.visualViewport;
    const vvH = vv ? Math.round(vv.height) : null;
    if (vvH != null) minVv = Math.min(minVv, vvH);
    const sec = ((performance.now() - started) / 1000).toFixed(1);
    lines.push(`${sec}秒 ${label}：画面 ${Math.round(window.innerHeight)}、見える範囲 ${vvH ?? 'なし'}（上 ${vv ? Math.round(vv.offsetTop) : '-'}）、ページのずれ ${Math.round(window.scrollY)}、キーボード ${keyboardState.inset}${keyboardState.guessed ? '（見込み）' : ''}`);
    lines = lines.slice(-8);
    const shrink = Number.isFinite(minVv) ? Math.round(window.innerHeight - minVv) : null;
    output.textContent = [
      `ホーム画面のアプリ：${isStandalone() ? 'はい' : 'いいえ'}`,
      `見える範囲がいちばん狭くなった分：${shrink ?? 'なし'}px（伝わっていれば 250〜400 くらい。0 なら伝わっていない）`,
      ...lines,
    ].join('\n');
  };
  const onResize = () => read('見える範囲が変わった');
  input.addEventListener('focus', () => {
    started = performance.now();
    lines = [];
    minVv = Infinity;
    timers.forEach(clearTimeout);
    read('欄を押した');
    timers = [300, 700, 1500].map((ms) => setTimeout(() => read('待った'), ms));
    window.visualViewport?.addEventListener('resize', onResize);
  });
  input.addEventListener('blur', () => {
    timers.forEach(clearTimeout);
    window.visualViewport?.removeEventListener('resize', onResize);
    read('キーボードを閉じた');
  });
}
