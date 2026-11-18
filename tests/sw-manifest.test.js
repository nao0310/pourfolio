// sw.js の一覧が今のファイルと合っているか（作り直し忘れの検出）と、読み込むファイルの漏れがないか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readManifestBlock, htmlAssets, jsImports } from '../js/core/offline.js';
import { currentManifest, ROOT } from '../scripts/make-sw-manifest.js';

const swSource = await readFile(path.join(ROOT, 'sw.js'), 'utf8');
const inSw = readManifestBlock(swSource);

test('sw.js の一覧が今のファイルと合っている（合わなければ npm run sw を実行してください）', async () => {
  const now = await currentManifest();
  assert.ok(inSw, 'sw.js に一覧がありません');
  const changed = Object.keys({ ...now.files, ...inSw.files }).filter((p) => now.files[p] !== inSw.files[p]);
  assert.deepEqual(changed, [], `一覧と違うファイル：${changed.join('、')} → npm run sw を実行してください`);
  assert.equal(inSw.version, now.version, 'npm run sw を実行してください');
});

test('全画面が読み込むファイルと、その import 先がすべて一覧に入っている', async () => {
  const files = inSw.files;
  const pages = Object.keys(files).filter((p) => p.endsWith('.html'));
  assert.ok(pages.includes('index.html'));
  const missing = [];
  const queue = [];
  for (const page of pages) {
    for (const asset of htmlAssets(await readFile(path.join(ROOT, page), 'utf8'))) {
      if (!(asset in files)) missing.push(`${page} → ${asset}`);
      else if (/\.m?js$/.test(asset)) queue.push(asset);
    }
  }
  const seen = new Set();
  while (queue.length) {
    const js = queue.pop();
    if (seen.has(js)) continue;
    seen.add(js);
    for (const dep of jsImports(js, await readFile(path.join(ROOT, js), 'utf8'))) {
      if (!(dep in files)) missing.push(`${js} → ${dep}`);
      else queue.push(dep);
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(seen.has('vendor/dexie/dexie.mjs'), 'データベースのライブラリまでたどれている');
});

test('アイコンと manifest も一覧に入っている', async () => {
  const mf = JSON.parse(await readFile(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of mf.icons) assert.ok(icon.src in inSw.files, icon.src);
  assert.ok('manifest.webmanifest' in inSw.files);
});
