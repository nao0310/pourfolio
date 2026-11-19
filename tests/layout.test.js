// 画面の作り（D-184）：下のタブ・下に付けるボタンに固定（position: fixed）を使わない。
// iPhone のホーム画面のアプリで、固定した下のタブがスクロールと一緒に上へ流れた（3-1.1 と 3.6.1 のあと、2回）。
// ページ全体はスクロールさせず、中身（main）だけをスクロールし、タブはそのあとに普通に並べる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(root, 'css/base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** そのセレクタ（そのまま）の宣言をすべて集める */
function rules(selector) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const sels = m[1].split(',').map((x) => x.trim());
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out.join(';');
}

test('下のタブと下に付けるボタンは固定（position: fixed）を使わない', () => {
  for (const sel of ['.tabbar', '.bottom-bar', '.wr-nav']) {
    assert.doesNotMatch(rules(sel), /position:\s*fixed/, sel);
  }
  // どこにも .tabbar / .bottom-bar を fixed にする指定がない
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\.(tabbar|bottom-bar)\b/.test(m[1])) assert.doesNotMatch(m[2], /position:\s*fixed/, m[1].trim());
  }
  assert.match(rules('.bottom-bar'), /position:\s*sticky/);
});

test('ページ全体はスクロールさせず、中身（main）だけがスクロールする', () => {
  assert.match(rules('html'), /overflow:\s*hidden/);
  const body = rules('body');
  assert.match(body, /overflow:\s*hidden/);
  assert.match(body, /display:\s*flex/);
  assert.match(body, /flex-direction:\s*column/);
  assert.match(body, /position:\s*relative/);
  const main = rules('main');
  assert.match(main, /overflow-y:\s*auto/);
  assert.match(main, /min-height:\s*0/);
  // 印刷ではページ全体を流す
  assert.match(css, /@media print\s*\{[^}]*html, body \{ height: auto; overflow: visible; display: block; \}/);
});

test('全画面：body の中は main と下のタブ（淹れる画面はタイマー）だけ', () => {
  for (const f of readdirSync(root).filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(join(root, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
    // body の直下の要素（script を除く）を浅く数える
    const top = [];
    let depth = 0;
    for (const m of body.matchAll(/<(\/?)([a-z][a-z0-9-]*)[^>]*?(\/?)>/g)) {
      const [, close, tag, self] = m;
      if (['br', 'img', 'input', 'meta', 'link', 'hr', 'wbr', 'source', 'path', 'circle', 'rect', 'line', 'polyline'].includes(tag) || self) continue;
      if (close) depth--;
      else {
        if (depth === 1 && tag !== 'script') top.push(tag);
        depth++;
      }
    }
    const allowed = f === 'brew.html' ? ['main', 'section', 'nav'] : ['main', 'nav'];
    for (const t of top) assert.ok(allowed.includes(t), `${f}：body の直下に ${t}`);
    assert.equal(top[0], 'main', f);
  }
});

test('JS は window.scrollTo を使わない（中身の箱を動かす scrollToTop を使う）', () => {
  const dir = join(root, 'js');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'layout.js')) {
    const s = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(s, /window\.scrollTo\(/, f);
  }
  const layout = readFileSync(join(root, 'js/layout.js'), 'utf8');
  assert.match(layout, /addEventListener\('focusout'/); // キーボードを閉じたあとのずれを戻す
  assert.match(readFileSync(join(root, 'js/page-life.js'), 'utf8'), /watchLayout\(\);/);
});

test('入力中（キーボードが出ている間）は、ページ全体のずれを戻さず、欄を見える所へ動かす（3.6.3、D-185）', () => {
  const layout = readFileSync(join(root, 'js/layout.js'), 'utf8');
  // カーソルが入ったら欄を見せる
  assert.match(layout, /addEventListener\('focusin'/);
  assert.match(layout, /revealFocused/);
  // 見える範囲が変わったときに、入力中かを見ずに window.scrollTo で戻さない（Safari が欄を見せる動きを打ち消すため）
  assert.doesNotMatch(layout, /visualViewport\?\.addEventListener\('resize',\s*fix\)/);
  assert.match(layout, /if \(!isTyping\(\)\) return settle\(\);/);
  assert.match(layout, /const settle = \(\) => \{\s*if \(isTyping\(\)\) return;/);
  // キーボードの高さ分の余白（いちばん下の欄も動かせるように）
  assert.match(css, /main\.kb-open::after\s*\{[^}]*height:\s*var\(--kb/);
});

test('ホーム画面のアプリでキーボードの高さが伝わらないときは、見込みで動かす（3.6.4、D-186）', () => {
  const layout = readFileSync(join(root, 'js/layout.js'), 'utf8');
  // カーソルが入って少したっても高さが0なら見込みを使う（指で操作する端末・文字盤の出る欄だけ）
  assert.match(layout, /setTimeout\(\(\) => revealFocused\(\{ guess: true \}\), \d+\)/);
  assert.match(layout, /\(hover: none\) and \(pointer: coarse\)/);
  assert.match(layout, /opensKeyboard\(/);
  // 見込みで動かしている間は、ずれを戻さない
  assert.match(layout, /currentInset\(\) === 0 && !keyboardState\.guessed/);
  // データの画面に「キーボードの点検」
  assert.match(readFileSync(join(root, 'data.html'), 'utf8'), /id="kbCheckInput"/);
});
