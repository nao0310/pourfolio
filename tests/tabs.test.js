// 下の5つのタブ（D-063・D-118）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { TABS, TAB_PAGES, NO_TAB_PAGES, tabForPath } from '../js/core/tabs.js';

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
