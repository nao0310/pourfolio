// グラインダー目盛り表（D2）：粒度の目安と、別のグラインダーへの換算
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScaleRows, umAt, settingFor, convertSetting, sizeWord, grindSizeText } from '../js/core/grinder-scale.js';

const c40 = { kind: 'grinder', attrs: { step: 1, scale: [{ setting: 20, um: 600 }, { setting: 30, um: 900 }] } };
const flat = { kind: 'grinder', attrs: { step: 0.5, scale: [{ setting: 2, um: 400 }, { setting: 4, um: 800 }, { setting: 6, um: 1200 }] } };

test('表の入力：空の行は捨て、目盛りの順に並べ、同じ目盛りや範囲外はエラー', () => {
  assert.deepEqual(normalizeScaleRows([{ setting: '３０', um: '900' }, { setting: '20', um: '600.4' }, {}]), {
    value: [{ setting: 20, um: 600 }, { setting: 30, um: 900 }],
    error: null,
  });
  assert.ok(normalizeScaleRows([{ setting: '20', um: '600' }, { setting: '20', um: '700' }]).error);
  assert.ok(normalizeScaleRows([{ setting: '20', um: '' }]).error);
  assert.ok(normalizeScaleRows([{ setting: '20', um: '3000' }]).error);
  assert.deepEqual(normalizeScaleRows([]), { value: [], error: null });
});

test('目盛りから粒度：表の間は直線で結び、外側は端の傾きで延ばす', () => {
  assert.deepEqual(umAt(c40.attrs.scale, 20), { um: 600, outside: false });
  assert.deepEqual(umAt(c40.attrs.scale, 24), { um: 720, outside: false });
  assert.deepEqual(umAt(c40.attrs.scale, '32'), { um: 960, outside: true });
  assert.deepEqual(umAt(c40.attrs.scale, 18), { um: 540, outside: true });
  assert.equal(umAt(c40.attrs.scale, 'abc'), null);
  assert.equal(umAt([], 20), null);
  // 1行だけの表は、その目盛りのときだけ分かる
  assert.deepEqual(umAt([{ setting: 20, um: 600 }], 20), { um: 600, outside: false });
  assert.equal(umAt([{ setting: 20, um: 600 }], 22), null);
});

test('粒度から目盛り：刻みに丸める', () => {
  assert.deepEqual(settingFor(flat.attrs.scale, 720, 0.5), { setting: 3.5, outside: false }); // 3.6 → 3.5
  assert.deepEqual(settingFor(flat.attrs.scale, 1300, 0.5), { setting: 6.5, outside: true });
  assert.equal(settingFor([{ setting: 1, um: 500 }], 500), null);
  assert.equal(settingFor([{ setting: 1, um: 800 }, { setting: 2, um: 500 }], 600), null); // 逆向きの表は換算しない
});

test('別のグラインダーへの換算', () => {
  assert.deepEqual(convertSetting(c40, 24, flat), { um: 720, setting: 3.5, word: '中細挽き', outside: false });
  assert.deepEqual(convertSetting(flat, 4, c40), { um: 800, setting: 27, word: '中挽き', outside: false });
  assert.equal(convertSetting(c40, 24, { attrs: {} }), null);
  assert.equal(convertSetting({ attrs: {} }, 24, flat), null);
});

test('粒度の言葉と短い文', () => {
  assert.equal(sizeWord(250), '極細挽き');
  assert.equal(sizeWord(700), '中細挽き');
  assert.equal(sizeWord(2000), '粗挽き');
  assert.equal(sizeWord(null), '');
  assert.equal(grindSizeText(c40, 24), '約720µm（中細挽き）');
  assert.equal(grindSizeText(c40, 35), '約1050µm（粗挽き・表の外側）');
  assert.equal(grindSizeText({ attrs: {} }, 24), '');
});
