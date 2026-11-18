// 画面の切り替え効果（view transition）を使わない（D-156）
// ホーム画面に追加したiPhoneのアプリで、画面を何度か移ると下のタブが固定されずにページと一緒に動く不具合が出たため。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const list = (dir, ext) => readdirSync(join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => join(dir, f));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('CSS・HTML・JS に画面の切り替え効果がない', () => {
  const files = [...list('css', '.css'), ...list('.', '.html'), ...list('js', '.js'), ...list('js/core', '.js')];
  assert.ok(files.length > 20);
  for (const f of files) {
    const s = stripComments(readFileSync(join(root, f), 'utf8'));
    assert.doesNotMatch(s, /@view-transition|view-transition-name|::view-transition|startViewTransition/, `${f} に画面の切り替え効果があります（D-156）`);
  }
});

test('下のタブは画面の下に固定する', () => {
  const css = stripComments(readFileSync(join(root, 'css/base.css'), 'utf8'));
  const rule = css.match(/\.tabbar\s*\{([^}]*)\}/);
  assert.ok(rule, '.tabbar の指定がありません');
  assert.match(rule[1], /position:\s*fixed/);
  assert.match(rule[1], /bottom:\s*0/);
});
