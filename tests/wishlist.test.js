// 気になる豆（F6）の入力・購入済みの判定・登録画面に入れる値
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWishInput, wishFormFromProduct, wishToFormValues, boughtBeanOf, splitWishlist, wishToBeanForm, wishSummary } from '../js/core/wishlist.js';
import { parseProductText } from '../js/core/tonya.js';

const at = (d) => `2026-11-${String(d).padStart(2, '0')}T00:00:00.000Z`;

test('入力：銘柄は必須、URL・焙煎度・価格・重さを確かめる', () => {
  const bad = normalizeWishInput({ name: ' ', productUrl: 'tonya.co.jp', roastLevel: '深煎り', priceJpy: '-1', labelWeightG: '0' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['labelWeightG', 'name', 'priceJpy', 'productUrl', 'roastLevel']);
  const ok = normalizeWishInput({ name: 'ケニア　ＡＡ', productUrl: 'https://example.com/p/1', roastLevel: 'シティ', priceJpy: '1,280円', labelWeightG: '200g', country: 'ケニア' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.name, 'ケニア AA', '全角は半角にそろえる');
  assert.equal(ok.value.priceJpy, 1280);
  assert.equal(ok.value.labelWeightG, 200);
  assert.equal(ok.value.labelWeightBasis, 'green');
  assert.equal(ok.value.origin.country, 'ケニア');
  // 何も入れなければ重さも空
  assert.equal(normalizeWishInput({ name: 'x' }).value.labelWeightG, null);
});

test('価格表は形の正しい行だけ残す', () => {
  const { value } = normalizeWishInput({ name: 'x', priceTable: [{ g: 100, priceJpy: 720 }, { g: 'a', priceJpy: 1 }, null] });
  assert.deepEqual(value.priceTable, [{ g: 100, priceJpy: 720 }]);
});

test('商品ページの読み取り結果を、気になる豆の値にする', () => {
  const text = [
    'ホーム > 生豆・コーヒー豆 > 中南米',
    'ガテマラSHB',
    '4.5',
    '(1262)',
    '生産国：グアテマラ',
    '精製方法：ウォッシュド',
    '標準の【ミディアムロースト】',
    '720円1,280円1,740円',
  ].join('\n');
  const p = parseProductText(text);
  assert.ok(p.found);
  const form = wishFormFromProduct(p, ' https://example.com/x ');
  const { value, errors } = normalizeWishInput(form);
  assert.deepEqual(errors, {});
  assert.equal(value.name, 'ガテマラSHB');
  assert.equal(value.origin.country, 'グアテマラ');
  assert.equal(value.roastLevel, 'ミディアム');
  assert.equal(value.labelWeightG, 100);
  assert.equal(value.priceJpy, 720);
  assert.equal(value.priceTable.length, 3);
  assert.equal(value.productUrl, 'https://example.com/x');
  // 編集の画面に戻すと同じ値
  assert.equal(normalizeWishInput({ ...wishToFormValues(value), priceTable: value.priceTable }).value.name, 'ガテマラSHB');
});

test('購入済みの判定：つないだ豆、あとで登録したURLか銘柄が同じ豆', () => {
  const wish = { id: 'w1', name: 'ケニア AA', productUrl: 'https://example.com/p/9?ref=a', createdAt: at(10), deletedAt: null };
  assert.equal(boughtBeanOf(wish, []), null);
  // 気になる豆を足す前に買った同じ銘柄の豆は「購入済み」にしない
  assert.equal(boughtBeanOf(wish, [{ id: 'old', name: 'ケニアAA', createdAt: at(1), deletedAt: null }]), null);
  assert.equal(boughtBeanOf(wish, [{ id: 'b1', name: '別の名前', productUrl: 'https://example.com/p/9/', createdAt: at(12), deletedAt: null }])?.id, 'b1');
  assert.equal(boughtBeanOf(wish, [{ id: 'b2', name: 'ｹﾆｱ ＡＡ', createdAt: at(12), deletedAt: null }])?.id, 'b2');
  assert.equal(boughtBeanOf(wish, [{ id: 'b3', name: 'ケニア AA', createdAt: at(12), deletedAt: at(13) }]), null, '消した豆は数えない');
  assert.equal(boughtBeanOf({ ...wish, boughtBeanId: 'old' }, [{ id: 'old', name: 'x', createdAt: at(1), deletedAt: null }])?.id, 'old');
});

test('一覧を「まだ」と「購入済み」に分ける（新しい順、消したものは出さない）', () => {
  const list = [
    { id: 'a', name: 'A', createdAt: at(1), deletedAt: null },
    { id: 'b', name: 'B', createdAt: at(3), deletedAt: null },
    { id: 'c', name: 'C', createdAt: at(2), deletedAt: at(4) },
    { id: 'd', name: 'D', createdAt: at(2), deletedAt: null, boughtBeanId: 'bd' },
  ];
  const { open, bought } = splitWishlist(list, [{ id: 'bd', name: 'D', createdAt: at(5), deletedAt: null }]);
  assert.deepEqual(open.map((w) => w.id), ['b', 'a']);
  assert.deepEqual(bought.map((x) => x.wish.id), ['d']);
});

test('「買った」で開く登録画面の値：入荷待ち、焙煎度はおすすめ、価格は価格表から', () => {
  const w = {
    name: 'ガテマラSHB',
    productUrl: 'https://example.com/x',
    origin: { country: 'グアテマラ', region: '', farm: '' },
    process: 'ウォッシュト',
    roastLevel: 'ミディアム',
    labelWeightG: 100,
    priceJpy: 720,
    priceTable: [{ g: 100, priceJpy: 720 }, { g: 200, priceJpy: 1280 }],
  };
  const f = wishToBeanForm(w, { roastLevel: 'シティ', labelWeightG: 200 });
  assert.equal(f.status, 'ordered');
  assert.equal(f.roastLevel, 'シティ');
  assert.equal(f.labelWeightG, '200');
  assert.equal(f.priceJpy, '1280');
  assert.equal(f.shop, '珈琲問屋');
  assert.equal(f.country, 'グアテマラ');
  // 価格表がなく重さが違えば、価格は空（推測で入れない）
  assert.equal(wishToBeanForm({ ...w, priceTable: [] }, { labelWeightG: 300 }).priceJpy, '');
  assert.equal(wishToBeanForm({ ...w, priceTable: [] }).priceJpy, '720');
  assert.equal(wishToBeanForm({ ...w, priceTable: [] }).roastLevel, 'ミディアム');
});

test('1行の要約', () => {
  assert.equal(wishSummary({ origin: { country: 'ケニア' }, process: 'ウォッシュト', roastLevel: 'シティ', priceJpy: 900, labelWeightG: 100 }), 'ケニア・ウォッシュト・シティ（店の標準）・900円/100g');
  assert.equal(wishSummary({}), '');
});
