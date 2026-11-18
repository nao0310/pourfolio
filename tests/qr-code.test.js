import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrModules, qrSvg } from '../js/core/qr-code.js';

/** 3つの角の位置合わせの印（7×7、外枠と中の3×3が黒） */
function hasFinder(m, r0, c0) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (m[r0 + r][c0 + c] !== (ring || core)) return false;
    }
  }
  return true;
}

test('短い文字は小さいQR（21×21）で、3つの角に印がある', () => {
  const m = qrModules('HELLO');
  assert.equal(m.length, 21);
  assert.ok(hasFinder(m, 0, 0));
  assert.ok(hasFinder(m, 0, 14));
  assert.ok(hasFinder(m, 14, 0));
});

test('同じ文字からは同じ模様、長い文字は大きいQR', () => {
  const url = 'https://nao0310.github.io/pourfolio/brew.html?best=0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.deepEqual(qrModules(url), qrModules(url));
  assert.ok(qrModules(url).length > 21);
  assert.ok(qrModules('x'.repeat(1000)).length > qrModules(url).length);
});

test('SVG は白地に黒、まわりに余白', () => {
  const svg = qrSvg('HELLO', { label: '豆 <A>' });
  assert.match(svg, /^<svg [^>]*viewBox="0 0 29 29"/);
  assert.match(svg, /fill="#fff"/);
  assert.match(svg, /aria-label="豆 &lt;A&gt;"/);
  assert.match(svg, /M4 4h1v1h-1z/); // 左上の角の印は余白4マスの位置から
});
