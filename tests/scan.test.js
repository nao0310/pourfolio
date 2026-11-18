import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanTarget, canisterUrl } from '../js/core/scan-target.js';
import { qrModules } from '../js/core/qr-code.js';

const BASE = 'https://nao0310.github.io/pourfolio/';

test('このアプリの画面はアプリの中で開く', () => {
  assert.deepEqual(scanTarget(`${BASE}brew.html?best=b-1`, BASE), { kind: 'app', href: 'brew.html?best=b-1' });
  assert.deepEqual(scanTarget(BASE, BASE), { kind: 'app', href: './' });
  assert.deepEqual(scanTarget(canisterUrl(BASE, 'b 1'), BASE), { kind: 'app', href: 'brew.html?best=b%201' });
});

test('ほかの端末の共有リンクは、中身だけを自分の share.html で開く', () => {
  assert.deepEqual(scanTarget('https://friend.github.io/pourfolio/share.html#r=1.abc', BASE), { kind: 'share', href: 'share.html#r=1.abc' });
  assert.deepEqual(scanTarget('http://localhost:8080/share.html#r=0.xyz', BASE), { kind: 'share', href: 'share.html#r=0.xyz' });
});

test('知らないサイト・別の場所・ファイル以外は開かない', () => {
  assert.equal(scanTarget('https://example.com/brew.html', BASE).kind, 'other');
  assert.equal(scanTarget('https://nao0310.github.io/other/brew.html', BASE).kind, 'other');
  assert.equal(scanTarget(`${BASE}vendor/dexie/dexie.mjs`, BASE).kind, 'other');
  assert.equal(scanTarget('javascript:alert(1)', BASE).kind, 'other');
  assert.equal(scanTarget('ただの文字', BASE).text, 'ただの文字');
  assert.equal(scanTarget(`${BASE}share.html`, BASE).kind, 'app');
});

test('作ったQRを読み取りのライブラリで読める（行き来）', async () => {
  // jsQR は UMD。ブラウザでは self に入るので、Node でも self を用意してから読む
  globalThis.self ??= globalThis;
  await import('../vendor/jsqr/jsQR.js');
  const text = canisterUrl(BASE, '0f8fad5b-d9cb-469f-a165-70867728950e');
  const m = qrModules(text);
  const scale = 4;
  const quiet = 4;
  const size = (m.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  m.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }),
  );
  const found = globalThis.self.jsQR(data, size, size);
  assert.equal(found?.data, text);
});
