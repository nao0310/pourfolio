import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAppFile,
  sha256Hex,
  buildManifest,
  replaceManifestBlock,
  readManifestBlock,
  htmlAssets,
  jsImports,
} from '../js/core/offline.js';

test('保存するファイル：画面・css・js・icons・vendor・manifest だけ', () => {
  for (const p of ['index.html', 'brew.html', 'manifest.webmanifest', 'css/base.css', 'js/core/home.js', 'icons/icon-192.png', 'vendor/dexie/dexie.mjs']) {
    assert.equal(isAppFile(p), true, p);
  }
  for (const p of ['sw.js', 'package.json', 'README.md', 'CLAUDE.md', 'docs/spec.md', 'tests/home.test.js', 'scripts/serve.js', 'vendor/README.md', 'vendor/dexie/LICENSE', 'vendor/dexie/NOTICE', '.nojekyll', '.claude/launch.json', 'js/.DS_Store']) {
    assert.equal(isAppFile(p), false, p);
  }
});

test('指紋：SHA-256 の16進', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), await sha256Hex('abc'));
});

test('一覧：対象外を除き、名前の順に並び、1文字の変更で指紋と版が変わる', async () => {
  const files = [
    { path: 'js/a.js', bytes: 'export const a = 1;' },
    { path: 'index.html', bytes: '<p>hi</p>' },
    { path: 'docs/x.md', bytes: 'x' },
  ];
  const m1 = await buildManifest(files);
  assert.deepEqual(Object.keys(m1.files), ['index.html', 'js/a.js']);
  assert.match(m1.files['index.html'], /^[0-9a-f]{16}$/);
  assert.match(m1.version, /^[0-9a-f]{12}$/);
  assert.deepEqual(await buildManifest([...files].reverse()), m1, '並び順に関係なく同じ');

  const m2 = await buildManifest([{ ...files[0], bytes: 'export const a = 2;' }, files[1]]);
  assert.notEqual(m2.files['js/a.js'], m1.files['js/a.js']);
  assert.equal(m2.files['index.html'], m1.files['index.html']);
  assert.notEqual(m2.version, m1.version);

  const m3 = await buildManifest([files[1]]);
  assert.notEqual(m3.version, m1.version, 'ファイルが減っても版が変わる');
});

test('sw.js への書き込みと読み出し', async () => {
  const src = 'a\n// <manifest> npm run sw が書き込む（手で直さない）\nconst MANIFEST = {};\n// </manifest>\nb\n';
  assert.deepEqual(readManifestBlock(src), {});
  const m = await buildManifest([{ path: 'index.html', bytes: 'x' }]);
  const out = replaceManifestBlock(src, m);
  assert.ok(out.startsWith('a\n') && out.endsWith('\nb\n'));
  assert.deepEqual(readManifestBlock(out), m);
  assert.equal(replaceManifestBlock(out, m), out, '同じ一覧なら変わらない');
  assert.throws(() => replaceManifestBlock('no marker', m), /印/);
  assert.equal(readManifestBlock('no marker'), null);
});

test('HTML が読み込むファイル：外のURLとページのリンクは含めない', () => {
  const html = `<link rel="manifest" href="manifest.webmanifest">
    <link rel="stylesheet" href="./css/base.css?x=1">
    <link rel="preconnect" href="https://example.com">
    <img class="logo" src="icons/icon-192.png" alt="">
    <a href="beans.html">豆</a>
    <script type="module" src="js/index-page.js"></script>`;
  assert.deepEqual(htmlAssets(html).sort(), ['css/base.css', 'icons/icon-192.png', 'js/index-page.js', 'manifest.webmanifest']);
});

test('JavaScript の import 先を位置から解決する', () => {
  const src = `import { a } from './core/a.js';
import {
  b,
  c,
} from '../vendor/dexie/dexie.mjs';
export { d } from "./d.js";
import './side.js';
const m = await import('./lazy.js');
import x from 'node:fs';`;
  assert.deepEqual(jsImports('js/page.js', src).sort(), ['js/core/a.js', 'js/d.js', 'js/lazy.js', 'js/side.js', 'vendor/dexie/dexie.mjs']);
});
