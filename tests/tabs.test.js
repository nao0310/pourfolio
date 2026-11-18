// 下の5つのタブ（D-063・D-118）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { TABS, TAB_PAGES, NO_TAB_PAGES, tabForPath, tabbarHtml, withTabbar, withColorScheme, TABBAR_START, COLOR_SCHEME_META } from '../js/core/tabs.js';

test('画面のパスからタブを決める。入力の途中の画面にはタブを出さない', () => {
  assert.equal(tabForPath('/pourfolio/'), 'home');
  assert.equal(tabForPath('/pourfolio/index.html'), 'home');
  assert.equal(tabForPath('/bean.html'), 'beans');
  assert.equal(tabForPath('/factors.html'), 'analysis');
  assert.equal(tabForPath('/brew.html'), null);
  assert.equal(tabForPath('/tasting.html'), null);
  assert.deepEqual(TABS.map((t) => t.label), ['ホーム', '抽出', '豆と在庫', '分析', 'その他']);
});

test('全部の画面が、タブを出す画面か出さない画面のどちらかに入っていて、タブの部品を読み込む', () => {
  const pages = readdirSync(new URL('..', import.meta.url)).filter((f) => f.endsWith('.html'));
  for (const p of pages) {
    assert.ok(TAB_PAGES.includes(p) || NO_TAB_PAGES.includes(p), `${p} を js/core/tabs.js の表に入れてください`);
    if (p === 'storage-test.html') continue;
    const html = readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
    assert.ok(html.includes('js/tabbar.js'), `${p} に js/tabbar.js がありません`);
  }
  for (const t of TABS) {
    const file = t.href === './' ? 'index.html' : t.href;
    assert.ok(pages.includes(file), `${file} がありません`);
  }
});

test('タブの HTML：今の画面のタブに印を付け、5つとも絵と名前がある（2-8 の3番）', () => {
  const h = tabbarHtml('beans');
  assert.equal((h.match(/<a class="tab/g) ?? []).length, 5);
  assert.equal((h.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(h, /<a class="tab current" href="beans.html" aria-current="page">/);
  for (const t of TABS) assert.ok(h.includes(`<span class="tab-label">${t.label}</span>`));
});

test('タブの書き込み：</main> のあとに入れ、2回目は入れ替えるだけ。タブを出さない画面は変えない', () => {
  const page = ['<body>', '<main>x</main>', '<script></script>', '</body>'].join('\n');
  const once = withTabbar('more.html', page);
  assert.ok(once.indexOf(TABBAR_START) > once.indexOf('</main>'));
  assert.equal(withTabbar('more.html', once), once);
  assert.equal(withTabbar('brew.html', page), page);
  assert.throws(() => withTabbar('more.html', '<body></body>'));
});

test('色の設定の印：charset の次の行に1つだけ入れる', () => {
  const head = ['<head>', '  <meta charset="utf-8">', '  <title>t</title>'].join('\n');
  const once = withColorScheme(head);
  assert.equal(once, ['<head>', '  <meta charset="utf-8">', `  ${COLOR_SCHEME_META}`, '  <title>t</title>'].join('\n'));
  assert.equal(withColorScheme(once), once);
});

test('全部の画面に、最新のタブと色の設定の印が書き込まれている（合わなければ npm run sw を実行してください）', () => {
  const pages = readdirSync(new URL('..', import.meta.url)).filter((f) => f.endsWith('.html'));
  const stale = pages.filter((p) => {
    const html = readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
    return withColorScheme(withTabbar(p, html)) !== html;
  });
  assert.deepEqual(stale, [], `${stale.join('、')} → npm run sw を実行してください`);
});
