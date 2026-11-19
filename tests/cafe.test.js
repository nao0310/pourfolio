// お店で飲んだ1杯（X37、D-188）の入力の確かめ・並べ替え・検索・店名の候補
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCafeInput, cafeToFormValues, sortCafeVisits, searchCafeVisits, shopNameSuggestions, cafeSummary, toLocalInputValue } from '../js/core/cafe.js';

test('店の名前と日時だけで記録できる。ほかの欄は空でよい', () => {
  const { value, errors } = normalizeCafeInput({ shopName: ' 喫茶　ほとり ', at: '2026-11-19T10:30' });
  assert.deepEqual(errors, {});
  assert.equal(value.shopName, '喫茶 ほとり', '全角の空白は半角にそろえる');
  assert.equal(value.at, new Date('2026-11-19T10:30').toISOString());
  assert.equal(value.method, null);
  assert.equal(value.temp, null);
  assert.equal(value.roastLevel, null);
  assert.equal(value.priceJpy, null);
  assert.equal(value.stars, null);
});

test('店の名前と日時がないと止める', () => {
  const { errors } = normalizeCafeInput({ shopName: '', at: '' });
  assert.ok(errors.shopName);
  assert.ok(errors.at);
  assert.ok(normalizeCafeInput({ shopName: 'A', at: 'あした' }).errors.at);
});

test('値段・★・淹れ方・焙煎度を確かめる', () => {
  const ok = normalizeCafeInput({ shopName: 'A', at: '2026-11-19T10:30', priceJpy: '６５０円', stars: '4', method: 'drip', temp: 'iced', roastLevel: 'シティ' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.priceJpy, 650);
  assert.equal(ok.value.stars, 4);
  assert.equal(ok.value.method, 'drip');
  assert.equal(ok.value.temp, 'iced');
  const bad = normalizeCafeInput({ shopName: 'A', at: '2026-11-19T10:30', priceJpy: '-1', stars: '6', method: 'siphon', temp: 'warm', roastLevel: '深煎り' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['method', 'priceJpy', 'roastLevel', 'stars', 'temp']);
  assert.equal(bad.value.priceJpy, null);
  assert.equal(bad.value.stars, null);
});

test('保存した記録をフォームに戻すと、もう一度確かめても同じ中身になる', () => {
  const { value } = normalizeCafeInput({ shopName: 'A', drinkName: 'ラテ', at: '2026-11-19T10:30', priceJpy: '700', stars: '3', method: 'milk', temp: 'hot', beanName: 'ブラジル', memo: 'まろやか' });
  const again = normalizeCafeInput(cafeToFormValues(value));
  assert.deepEqual(again.errors, {});
  assert.deepEqual(again.value, value);
});

test('日時の入力欄の形（端末の時刻）', () => {
  assert.equal(toLocalInputValue(new Date(2026, 10, 19, 7, 5)), '2026-11-19T07:05');
  assert.equal(toLocalInputValue('だめ'), '');
});

const rec = (id, at, shopName, extra = {}) => ({ id, at, shopName, createdAt: at, updatedAt: at, deletedAt: null, ...extra });

test('新しい順に並べ、削除の印が付いたものは出さない', () => {
  const list = [
    rec('a', '2026-11-01T01:00:00.000Z', 'A'),
    rec('b', '2026-11-10T01:00:00.000Z', 'B'),
    rec('c', '2026-11-05T01:00:00.000Z', 'C', { deletedAt: '2026-11-06T00:00:00.000Z' }),
  ];
  assert.deepEqual(sortCafeVisits(list).map((v) => v.id), ['b', 'a']);
});

test('店・飲み物・豆・メモで探せる（空白で区切るとすべてを含むもの）', () => {
  const list = [
    rec('a', '2026-11-01T01:00:00.000Z', 'ほとり珈琲', { drinkName: 'ケニア', memo: '' }),
    rec('b', '2026-11-02T01:00:00.000Z', 'ＢＬＵＥ Cafe', { drinkName: 'カフェラテ', beanName: 'ブラジル' }),
  ];
  assert.deepEqual(searchCafeVisits(list, '').map((v) => v.id), ['b', 'a']);
  assert.deepEqual(searchCafeVisits(list, 'blue').map((v) => v.id), ['b'], '全角・大文字の違いを無視');
  assert.deepEqual(searchCafeVisits(list, 'ほとり ケニア').map((v) => v.id), ['a']);
  assert.deepEqual(searchCafeVisits(list, 'ほとり ブラジル'), []);
});

test('店の名前の候補は、よく行く順で、表記ゆれは1つにまとめる', () => {
  const list = [
    rec('a', '2026-11-01T01:00:00.000Z', 'Blue Cafe'),
    rec('b', '2026-11-02T01:00:00.000Z', 'ほとり'),
    rec('c', '2026-11-03T01:00:00.000Z', 'BLUE CAFE'),
    rec('d', '2026-11-04T01:00:00.000Z', 'ほし'),
  ];
  assert.deepEqual(shopNameSuggestions(list), ['BLUE CAFE', 'ほし', 'ほとり']);
});

test('一覧の説明', () => {
  assert.equal(cafeSummary({ method: 'drip', temp: 'hot', beanName: 'ケニア', roastLevel: 'シティ', priceJpy: 1200 }), 'ハンドドリップ・ホット / ケニア シティロースト / 1,200円');
  assert.equal(cafeSummary({}), '');
});
