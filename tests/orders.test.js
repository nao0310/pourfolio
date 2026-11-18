import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysYmd,
  normalizeOrderItem,
  orderFields,
  beansFromOrder,
  arrivalChanges,
  deliveryDays,
  DEFAULT_DELIVERY_DAYS,
  MAX_BAGS,
} from '../js/core/orders.js';
import { BEAN_STATUS, normalizeBeanInput } from '../js/core/beans.js';

test('日付に日数を足す（月・年をまたぐ）', () => {
  assert.equal(addDaysYmd('2026-11-30', 1), '2026-12-01');
  assert.equal(addDaysYmd('2027-01-01', -1), '2026-12-31');
  assert.equal(addDaysYmd('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysYmd('2026/11/30', 1), null);
});

test('品目：銘柄・重さ・数量を確かめ、全角やカンマも読む', () => {
  const { value, errors } = normalizeOrderItem({ name: ' コロンビア ', roastLevel: 'シティ', labelWeightG: '２００', qty: '2', priceJpy: '1,280' });
  assert.deepEqual(errors, {});
  assert.deepEqual(value, {
    name: 'コロンビア',
    productCode: '',
    roastLevel: 'シティ',
    labelWeightG: 200,
    qty: 2,
    priceJpy: 1280,
    productUrl: '',
    labelWeightBasis: 'green',
    process: '',
    farm: '',
  });
  assert.equal(normalizeOrderItem({ name: 'x', roastLevel: '中煎り', labelWeightG: 100 }).value.roastLevel, '', '8段階にない焙煎度は空にする');
  const bad = normalizeOrderItem({ name: '', labelWeightG: 0, qty: 0, priceJpy: -1 }).errors;
  assert.deepEqual(Object.keys(bad).sort(), ['labelWeightG', 'name', 'priceJpy', 'qty']);
  assert.ok(normalizeOrderItem({ name: 'x', labelWeightG: 100, qty: MAX_BAGS + 1 }).errors.qty);
  assert.ok(normalizeOrderItem({ name: 'x', labelWeightG: 100, qty: 1.5 }).errors.qty);
  assert.equal(normalizeOrderItem({ name: 'x', labelWeightG: 100 }).value.qty, 1, '数量がなければ1');
});

test('注文の記録：品目と送料、注文日の形', () => {
  const items = [normalizeOrderItem({ name: 'A', roastLevel: 'ハイ', labelWeightG: 100, qty: 1, priceJpy: 600 }).value];
  const o = orderFields({ orderNo: ' 12345 ', orderDate: '2026-11-10', shippingJpy: 500, items });
  assert.equal(o.shop, '珈琲問屋');
  assert.equal(o.orderNo, '12345');
  assert.deepEqual(o.items, [{ name: 'A', productCode: '', roastLevel: 'ハイ', labelWeightG: 100, labelWeightBasis: 'green', qty: 1, priceJpy: 600 }]);
  assert.equal(orderFields({ orderDate: '2026-11-10', shippingJpy: NaN, items }).shippingJpy, null);
  assert.throws(() => orderFields({ orderDate: '11/10', items }), /注文日/);
});

test('注文から1袋ずつ入荷待ちの豆を作る（生豆時の表記・1袋の価格・注文とつなぐ）', () => {
  const items = [
    normalizeOrderItem({ name: 'エチオピア', roastLevel: 'ミディアム', labelWeightG: 200, qty: 2, priceJpy: 1200 }).value,
    normalizeOrderItem({ name: 'ケニア', roastLevel: 'シティ', labelWeightG: 100, qty: 1 }).value,
  ];
  const beans = beansFromOrder({ orderId: 'o1', orderDate: '2026-11-10', items });
  assert.equal(beans.length, 3);
  assert.deepEqual(beans.map((b) => b.name), ['エチオピア', 'エチオピア', 'ケニア']);
  for (const b of beans) {
    assert.equal(b.status, 'ordered');
    assert.equal(BEAN_STATUS[b.status], '入荷待ち');
    assert.equal(b.labelWeightBasis, 'green');
    assert.equal(b.orderId, 'o1');
    assert.equal(b.orderDate, '2026-11-10');
    assert.equal(b.actualWeightG, null);
    assert.equal(b.roastDate, null);
  }
  assert.equal(beans[0].priceJpy, 1200);
  // 読み取った商品コード・精製・農園も豆に入る
  const [laos] = beansFromOrder({
    orderId: 'o2',
    orderDate: '2026-11-01',
    items: [normalizeOrderItem({ name: 'ラオス', productCode: '20564', labelWeightG: 300, process: 'ウォッシュト', farm: 'ミンティエン農園' }).value],
  });
  assert.equal(laos.productCode, '20564');
  assert.equal(laos.process, 'ウォッシュト');
  assert.equal(laos.origin.farm, 'ミンティエン農園');
  assert.equal(beans[2].priceJpy, null);
  const many = [normalizeOrderItem({ name: 'x', labelWeightG: 100, qty: MAX_BAGS }).value, normalizeOrderItem({ name: 'y', labelWeightG: 100, qty: 1 }).value];
  assert.throws(() => beansFromOrder({ orderId: 'o', orderDate: '2026-11-10', items: many }), /袋まで/);
});

test('豆の編集画面でも「入荷待ち」を選べる', () => {
  const { value, errors } = normalizeBeanInput({ name: 'x', labelWeightG: '100', status: 'ordered' });
  assert.deepEqual(errors, {});
  assert.equal(value.status, 'ordered');
});

test('届いた：実重量と到着日。焙煎日がなければ到着日の前日', () => {
  const { value, errors } = arrivalChanges({ arrivalDate: '2026-12-01', actualWeightG: '163.4' });
  assert.deepEqual(errors, {});
  assert.deepEqual(value, { status: 'unopened', arrivalDate: '2026-12-01', actualWeightG: 163.4, roastDate: '2026-11-30' });
  assert.equal(arrivalChanges({ arrivalDate: '2026-12-01', actualWeightG: '165g', roastDate: '2026-11-28' }).value.roastDate, '2026-11-28', '袋の焙煎日を優先');
  assert.ok(arrivalChanges({ arrivalDate: '2026-12-01', actualWeightG: '165', roastDate: '2026-12-03' }).errors.roastDate);
  const bad = arrivalChanges({ arrivalDate: '', actualWeightG: '0' }).errors;
  assert.deepEqual(Object.keys(bad).sort(), ['actualWeightG', 'arrivalDate']);
});

test('お届け日数：注文ごとの日数の中央値。2回未満なら設定の値', () => {
  const bean = (orderId, orderDate, arrivalDate, extra = {}) => ({ orderId, orderDate, arrivalDate, deletedAt: null, ...extra });
  assert.deepEqual(deliveryDays([]), { days: DEFAULT_DELIVERY_DAYS, learned: false, samples: 0 });
  assert.deepEqual(deliveryDays([bean('o1', '2026-11-01', '2026-11-04')], 6), { days: 6, learned: false, samples: 1 });
  // 同じ注文の2袋は1回と数える
  assert.equal(deliveryDays([bean('o1', '2026-11-01', '2026-11-04'), bean('o1', '2026-11-01', '2026-11-04')]).samples, 1);
  const three = [bean('o1', '2026-10-01', '2026-10-04'), bean('o2', '2026-10-10', '2026-10-17'), bean('o3', '2026-11-01', '2026-11-05')];
  assert.deepEqual(deliveryDays(three), { days: 4, learned: true, samples: 3 });
  assert.equal(deliveryDays(three.slice(0, 2)).days, 5, '偶数なら真ん中2つの平均（切り上げ）');
  // 注文日のない豆・削除した豆・おかしな日付は数えない
  const noisy = [...three, bean(null, null, '2026-11-05'), bean('o9', '2026-11-01', '2026-10-01'), bean('o8', '2026-11-01', '2026-11-30', { deletedAt: 'x' })];
  assert.equal(deliveryDays(noisy).samples, 3);
});
