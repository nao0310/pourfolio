// 香味の選択（B4）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLAVOR_WHEEL,
  DEFECT_TAGS,
  parseFlavor,
  flavorLabel,
  normalizeFlavors,
  normalizeDefects,
  countInCategory,
  toggleFlavor,
  flavorsText,
} from '../js/core/flavors.js';

test('9カテゴリ。キーと呼び方に重なりがない', () => {
  assert.equal(FLAVOR_WHEEL.length, 9);
  assert.deepEqual(
    FLAVOR_WHEEL.map((c) => c.label),
    ['フローラル', 'フルーティ', '酸っぱい・発酵', 'グリーン・植物', 'ロースト', 'スパイス', 'ナッツ・ココア', '甘い', 'その他'],
  );
  const keys = FLAVOR_WHEEL.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const c of FLAVOR_WHEEL) {
    assert.ok(c.words.length >= 4, c.label);
    const wk = c.words.map((w) => w.key);
    assert.equal(new Set(wk).size, wk.length, c.label);
    for (const w of c.words) assert.match(w.key, /^[a-z-]+$/);
  }
  assert.deepEqual(DEFECT_TAGS, ['えぐい', '紙っぽい', '焦げ', '古い（酸化）', '水っぽい']);
});

test('香味の値は「カテゴリ/語」かカテゴリだけ。呼び方は語があれば語', () => {
  assert.equal(parseFlavor('fruity/citrus').category.label, 'フルーティ');
  assert.equal(parseFlavor('fruity/citrus').word.label, '柑橘');
  assert.equal(parseFlavor('fruity').word, null);
  assert.equal(parseFlavor('fruity/jasmine'), null); // 別のカテゴリの語
  assert.equal(parseFlavor('nope'), null);
  assert.equal(flavorLabel('floral/jasmine'), 'ジャスミン');
  assert.equal(flavorLabel('nutty-cocoa'), 'ナッツ・ココア');
  assert.equal(flavorLabel('x/y'), '');
});

test('選んだ香味：知らない値と重なりを捨て、ホイールの並び順。足す・外す・数える', () => {
  assert.deepEqual(normalizeFlavors(['sweet/honey', 'floral', 'x', 'floral', 'fruity/lemon']), ['floral', 'fruity/lemon', 'sweet/honey']);
  assert.deepEqual(normalizeFlavors(null), []);
  let f = toggleFlavor([], 'fruity/lemon');
  f = toggleFlavor(f, 'fruity');
  assert.deepEqual(f, ['fruity', 'fruity/lemon']);
  assert.equal(countInCategory(f, 'fruity'), 2);
  assert.equal(countInCategory(f, 'floral'), 0);
  assert.deepEqual(toggleFlavor(f, 'fruity'), ['fruity/lemon']);
  assert.equal(flavorsText(['floral/jasmine', 'fruity/citrus', 'sweet/honey', 'roasted/smoky'], 3), 'ジャスミン・柑橘・スモーキー ほか1');
  assert.equal(flavorsText([]), '');
});

test('雑味タグ：知らないタグを捨て、いつも同じ並び。半角の括弧でも読める', () => {
  assert.deepEqual(normalizeDefects(['水っぽい', '謎', 'えぐい', '古い(酸化)']), ['えぐい', '古い（酸化）', '水っぽい']);
  assert.deepEqual(normalizeDefects(undefined), []);
});
