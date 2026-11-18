import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBeanInput, beanToFormValues, parseNumber, sortBeansForList, originText } from '../js/core/beans.js';

const base = { name: 'エチオピア イルガチェフェ', labelWeightG: '200', labelWeightBasis: 'green', roastLevel: 'シティ' };

test('銘柄と重量があれば保存できる', () => {
  const { value, errors } = normalizeBeanInput(base);
  assert.deepEqual(errors, {});
  assert.equal(value.name, 'エチオピア イルガチェフェ');
  assert.equal(value.labelWeightG, 200);
  assert.equal(value.labelWeightBasis, 'green');
  assert.equal(value.actualWeightG, null);
  assert.equal(value.status, 'unopened');
  assert.equal(value.roastDate, null);
});

test('銘柄がないとき、重量がどちらもないときはエラー', () => {
  const { errors } = normalizeBeanInput({ name: '  ' });
  assert.ok(errors.name);
  assert.ok(errors.labelWeightG);
  assert.deepEqual(normalizeBeanInput({ name: 'a', actualWeightG: '150' }).errors, {});
});

test('全角数字・単位・カンマを読める', () => {
  assert.equal(parseNumber('２００ｇ'), 200);
  assert.equal(parseNumber('1,200円'), 1200);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('たくさん')));
  const { value } = normalizeBeanInput({ ...base, priceJpy: '１，２００', actualWeightG: '166.54' });
  assert.equal(value.priceJpy, 1200);
  assert.equal(value.actualWeightG, 166.5);
});

test('おかしな値はエラーにする', () => {
  const { errors } = normalizeBeanInput({
    ...base,
    labelWeightG: '-5',
    roastLevel: '激深',
    roastDate: '2026-02-30',
    productUrl: 'tonya.co.jp',
    priceJpy: '-1',
  });
  assert.ok(errors.labelWeightG);
  assert.ok(errors.roastLevel);
  assert.ok(errors.roastDate);
  assert.ok(errors.productUrl);
  assert.ok(errors.priceJpy);
});

test('焙煎度は空でもよい（わからない豆のため）', () => {
  assert.deepEqual(normalizeBeanInput({ ...base, roastLevel: '' }).errors, {});
});

test('品種・精製の「その他」は自由入力の値を使い、編集画面に戻すと「その他」に戻る', () => {
  const { value } = normalizeBeanInput({ ...base, variety: 'その他', varietyOther: '74110', process: 'ナチュラル' });
  assert.equal(value.variety, '74110');
  assert.equal(value.process, 'ナチュラル');
  const form = beanToFormValues({ ...value, id: 'x' });
  assert.equal(form.variety, 'その他');
  assert.equal(form.varietyOther, '74110');
  assert.equal(form.process, 'ナチュラル');
});

test('保存した豆をフォームに戻して保存し直しても中身が変わらない', () => {
  const raw = {
    ...base,
    shop: '珈琲問屋',
    productUrl: 'https://example.com/p/1',
    country: 'エチオピア',
    region: 'イルガチェフェ',
    farm: '',
    variety: 'ゲイシャ',
    process: 'ウォッシュト',
    roastDate: '2026-11-10',
    orderDate: '2026-11-08',
    arrivalDate: '2026-11-12',
    actualWeightG: '166.5',
    priceJpy: '1200',
    flavorNotes: 'ジャスミン',
    memo: '',
    status: 'open',
  };
  const first = normalizeBeanInput(raw).value;
  const again = normalizeBeanInput(beanToFormValues(first)).value;
  assert.deepEqual(again, first);
});

test('一覧の並び：飲み切りは後ろ、ほかは焙煎日の新しい順', () => {
  const b = (id, roastDate, status = 'open', createdAt = '2026-11-01') => ({ id, roastDate, status, createdAt });
  const list = sortBeansForList([b('old', '2026-10-01'), b('done', '2026-11-15', 'finished'), b('new', '2026-11-10'), b('none', null)]);
  assert.deepEqual(
    list.map((x) => x.id),
    ['new', 'old', 'none', 'done'],
  );
});

test('産地を1行にまとめる', () => {
  assert.equal(originText({ origin: { country: 'エチオピア', region: 'イルガチェフェ', farm: '' } }), 'エチオピア・イルガチェフェ');
  assert.equal(originText({}), '');
});
