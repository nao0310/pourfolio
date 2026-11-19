// 注文・入荷待ち・到着（X29）とデータベース（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from '../vendor/dexie/dexie.mjs';
import { openDb, addOrder, listOrders, markArrived, getBeanWithTx, listBeans, readAll, exportAll, clearAll, restoreBackup } from '../js/db.js';
import { normalizeOrderItem, orderFields, arrivalChanges } from '../js/core/orders.js';
import { parseBackup } from '../js/core/backup.js';
import { remainingG } from '../js/core/inventory.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const item = (x) => {
  const { value, errors } = normalizeOrderItem(x);
  assert.deepEqual(errors, {});
  return value;
};
const ITEMS = [item({ name: 'エチオピア', roastLevel: 'ミディアム', labelWeightG: 200, qty: 2, priceJpy: 1200 }), item({ name: 'ケニア', roastLevel: 'シティ', labelWeightG: 100, qty: 1, priceJpy: 700 })];

test('移行：版2のデータベースを開き直すと、記録はそのままで注文の表が増える', async () => {
  const indexedDB = new IDBFactory();
  // 2-1までのアプリが作った版2のデータベース
  const v2 = new Dexie('pourfolio-test', { indexedDB, IDBKeyRange });
  v2.version(1).stores({
    beans: 'id, updatedAt, roastDate',
    inventoryTx: 'id, beanId, brewId, at, updatedAt',
    equipment: 'id, kind, updatedAt',
    recipes: 'id, parentId, updatedAt',
    brews: 'id, at, beanId, recipeId, updatedAt',
    tastings: 'id, brewId, updatedAt',
    settings: 'id',
  });
  v2.version(2).stores({ suggestions: 'id, brewId, beanId, updatedAt' });
  const at = NOW.toISOString();
  const bean = { id: 'bean1', name: 'グアテマラ', status: 'open', roastDate: '2026-11-10', createdAt: at, updatedAt: at, deletedAt: null };
  const tx = { id: 'tx1', beanId: 'bean1', brewId: null, at, deltaG: 160, kind: 'in', createdAt: at, updatedAt: at, deletedAt: null };
  const sug = { id: 's1', brewId: 'b1', beanId: 'bean1', createdAt: at, updatedAt: at, deletedAt: null };
  await v2.table('beans').put(bean);
  await v2.table('inventoryTx').put(tx);
  await v2.table('suggestions').put(sug);
  v2.close();

  const db = openDb('pourfolio-test', { indexedDB, IDBKeyRange });
  await db.open();
  assert.equal(db.verno, 7);
  const all = await readAll(db);
  assert.deepEqual(all.beans, [bean]);
  assert.deepEqual(all.inventoryTx, [tx]);
  assert.deepEqual(all.suggestions, [sug]);
  assert.deepEqual(all.orders, []);
  // 移行したあと注文を登録できる
  await addOrder(db, orderFields({ orderDate: '2026-11-18', items: ITEMS }), ITEMS, NOW);
  assert.equal((await listOrders(db)).length, 1);
  db.close();
});

test('注文を登録すると、1袋ずつ入荷待ちの豆ができ、入庫の履歴はまだ作らない', async () => {
  const db = freshDb();
  const { order, beans } = await addOrder(db, orderFields({ orderNo: 'A-1', orderDate: '2026-11-15', shippingJpy: 500, items: ITEMS }), ITEMS, NOW);
  assert.equal(beans.length, 3);
  const saved = await listBeans(db);
  assert.equal(saved.length, 3);
  for (const b of saved) {
    assert.equal(b.status, 'ordered');
    assert.equal(b.orderId, order.id);
    assert.match(b.id, /^[0-9a-f-]{36}$/);
  }
  const all = await readAll(db);
  assert.equal(all.inventoryTx.length, 0);
  assert.equal(all.orders[0].shippingJpy, 500);
  assert.equal(all.orders[0].items.length, 2);
});

test('届いた：未開封になり、量った重さで到着日の入庫ができる。焙煎日は前日', async () => {
  const db = freshDb();
  const { beans } = await addOrder(db, orderFields({ orderDate: '2026-11-15', items: ITEMS }), ITEMS, NOW);
  const { value, errors } = arrivalChanges({ arrivalDate: '2026-11-19', actualWeightG: '164.2' });
  assert.deepEqual(errors, {});
  await markArrived(db, beans[0].id, value, new Date('2026-11-19T10:00:00Z'));
  const { bean, txs } = await getBeanWithTx(db, beans[0].id);
  assert.equal(bean.status, 'unopened');
  assert.equal(bean.roastDate, '2026-11-18');
  assert.equal(bean.arrivalDate, '2026-11-19');
  assert.equal(txs.length, 1);
  assert.equal(txs[0].kind, 'in');
  assert.equal(remainingG(txs), 164.2);
  assert.equal(txs[0].memo, '', '量った値なので見積もりの注記なし');
  // ほかの2袋は入荷待ちのまま
  const rest = (await listBeans(db)).filter((b) => b.id !== beans[0].id);
  assert.deepEqual(rest.map((b) => b.status), ['ordered', 'ordered']);
});

test('入荷待ちに戻すと入庫の履歴に削除の印が付く（間違えて「届いた」を押したとき）', async () => {
  const db = freshDb();
  const { beans } = await addOrder(db, orderFields({ orderDate: '2026-11-15', items: ITEMS }), ITEMS, NOW);
  await markArrived(db, beans[2].id, arrivalChanges({ arrivalDate: '2026-11-19', actualWeightG: '83' }).value, NOW);
  const { updateBean } = await import('../js/db.js');
  await updateBean(db, beans[2].id, { status: 'ordered' }, NOW);
  const { txs } = await getBeanWithTx(db, beans[2].id);
  assert.equal(remainingG(txs), 0);
});

test('書き出し→全削除→復元で注文が戻る。注文の表がない古いファイルも復元できる', async () => {
  const db = freshDb();
  await addOrder(db, orderFields({ orderDate: '2026-11-15', items: ITEMS }), ITEMS, NOW);
  const file = JSON.parse(JSON.stringify(await exportAll(db, NOW)));
  assert.equal(file.tables.orders.length, 1);
  await clearAll(db);
  await restoreBackup(db, parseBackup(file));
  const all = await readAll(db);
  assert.equal(all.orders.length, 1);
  assert.equal(all.beans.length, 3);

  const old = JSON.parse(JSON.stringify(file));
  delete old.tables.orders;
  const db2 = freshDb();
  await restoreBackup(db2, parseBackup(old));
  assert.deepEqual((await readAll(db2)).orders, []);
  assert.equal((await readAll(db2)).beans.length, 3);
});
