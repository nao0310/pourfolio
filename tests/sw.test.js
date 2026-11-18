// sw.js の計算部分（URLから保存したファイルを探す、古い保存場所を消す）を、ブラウザの外で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const src = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ URL });
vm.runInContext(`${src}\n;globalThis.__sw = { cacheKeyFor, freshUrl, oldCacheNames, cacheNameOf, isDevHost, MANIFEST };`, ctx);
const sw = ctx.__sw;

const scope = 'https://nao0310.github.io/pourfolio/';
const files = { 'index.html': 'a', 'brew.html': 'b', 'js/core/home.js': 'c', 'manifest.webmanifest': 'd' };

test('URL から保存したファイルを探す', () => {
  const key = (u) => sw.cacheKeyFor(u, scope, files);
  assert.equal(key(scope), 'index.html');
  assert.equal(key(`${scope}index.html`), 'index.html');
  assert.equal(key(`${scope}?from=home`), 'index.html');
  assert.equal(key(`${scope}brew.html?recipe=abc&bean=1`), 'brew.html');
  assert.equal(key(`${scope}brew.html#top`), 'brew.html');
  assert.equal(key(`${scope}js/core/home.js`), 'js/core/home.js');
  assert.equal(key(`${scope}manifest.webmanifest`), 'manifest.webmanifest');
});

test('保存の対象でないURLは null（通常どおり通信する）', () => {
  const key = (u) => sw.cacheKeyFor(u, scope, files);
  assert.equal(key(`${scope}docs/spec.md`), null);
  assert.equal(key(`${scope}sw.js`), null);
  assert.equal(key('https://nao0310.github.io/other/index.html'), null, '別のサイト（同じドメインの別の場所）');
  assert.equal(key('https://api.open-meteo.com/v1/forecast?x=1'), null, '天気など外のサイト');
  assert.equal(key('https://nao0310.github.io/pourfolio'), null, '末尾の / がない形は範囲の外');
});

test('開発用サーバーでも同じように探せる', () => {
  assert.equal(sw.cacheKeyFor('http://localhost:8080/brew.html?x=1', 'http://localhost:8080/', files), 'brew.html');
  assert.equal(sw.isDevHost('localhost'), true);
  assert.equal(sw.isDevHost('127.0.0.1'), true);
  assert.equal(sw.isDevHost('nao0310.github.io'), false);
});

test('取り直しのURLに指紋を付ける', () => {
  assert.equal(sw.freshUrl('js/a.js', '0123abcd'), 'js/a.js?v=0123abcd');
});

test('古い版の保存場所だけを消す（ほかの名前は触らない）', () => {
  const names = ['pourfolio-aaa', 'pourfolio-bbb', 'other-cache', 'pourfolio-ccc'];
  assert.deepEqual([...sw.oldCacheNames(names, sw.cacheNameOf('bbb'))], ['pourfolio-aaa', 'pourfolio-ccc']);
});

test('sw.js に版と一覧が入っている', () => {
  assert.match(sw.MANIFEST.version, /^[0-9a-f]{12}$/);
  assert.ok(sw.MANIFEST.files['index.html']);
});
