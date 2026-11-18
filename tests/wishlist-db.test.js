// 気になる豆（F6）とデータベース（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from '../vendor/dexie/dexie.mjs';
import { openDb, readAll, addWish, listWishlist, getWish, updateWish, deleteWish, exportAll, clearAll, restoreBackup } from '../js/db.js';
import { normalizeWishInput } from '../js/core/wishlist.js';
import { parseBackup, makeBackup } from '../js/core/backup.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const wishValue = (raw) => {
  const { value, errors } = normalizeWishInput(raw);
  assert.deepEqual(errors, {});
  return value;
};

test('移行：版5のデータベースを開き直すと、記録はそのままで気になる豆の表が増える', async () => {
  const indexedDB = new IDBFactory();
  // 3-1までのアプリが作った版5のデータベース
  const v5 = new Dexie('pourfolio-test', { indexedDB, IDBKeyRange });
  v5.version(1).stores({
    beans: 'id, updatedAt, roastDate',
    inventoryTx: 'id, beanId, brewId, at, updatedAt',
    equipment: 'id, kind, updatedAt',
    recipes: 'id, parentId, updatedAt',
    brews: 'id, at, beanId, recipeId, updatedAt',
    tastings: 'id, brewId, updatedAt',
    settings: 'id',
  });
  v5.version(2).stores({ suggestions: 'id, brewId, beanId, updatedAt' });
  v5.version(3).stores({ orders: 'id, orderDate, updatedAt' });
  v5.version(4).stores({ frozenPortions: 'id, beanId, updatedAt' });
  v5.version(5).stores({ photos: 'id, brewId, updatedAt', experiments: 'id, updatedAt' });
  const at = NOW.toISOString();
  const bean = { id: 'bean1', name: 'グアテマラ', status: 'open', roastDate: '2026-11-10', createdAt: at, updatedAt: at, deletedAt: null };
  const exp = { id: 'e1', kind: 'optimize', entries: [], createdAt: at, updatedAt: at, deletedAt: null };
  await v5.table('beans').put(bean);
  await v5.table('experiments').put(exp);
  v5.close();

  const db = openDb('pourfolio-test', { indexedDB, IDBKeyRange });
  await db.open();
  assert.equal(db.verno, 6);
  const all = await readAll(db);
  assert.deepEqual(all.beans, [bean]);
  assert.deepEqual(all.experiments, [exp]);
  assert.deepEqual(all.wishlist, []);
  // 移行したあと気になる豆を足せる
  await addWish(db, wishValue({ name: 'ケニア' }), NOW);
  assert.equal((await listWishlist(db)).length, 1);
  db.close();
});

test('気になる豆を足す・直す・消す（消すと一覧と1件読みから消え、記録は印で残る）', async () => {
  const db = freshDb();
  const w = await addWish(db, wishValue({ name: 'エチオピア', country: 'エチオピア', priceJpy: '720' }), NOW);
  assert.equal(w.boughtBeanId, null);
  assert.equal(w.labelWeightG, 100, '価格だけのときは生豆時100gの値段とみなす');
  const later = new Date('2026-11-19T00:00:00Z');
  const u = await updateWish(db, w.id, { boughtBeanId: 'bean9' }, later);
  assert.equal(u.boughtBeanId, 'bean9');
  assert.equal(u.updatedAt, later.toISOString());
  assert.equal(u.createdAt, w.createdAt);
  await deleteWish(db, w.id, later);
  assert.equal(await getWish(db, w.id), null);
  assert.deepEqual(await listWishlist(db), []);
  const raw = await db.table('wishlist').get(w.id);
  assert.equal(raw.deletedAt, later.toISOString());
  await assert.rejects(() => updateWish(db, w.id, { memo: 'x' }), /見つかりません/);
  db.close();
});

test('バックアップ：気になる豆は書き出し→復元で残り、気になる豆のない古いファイルも読める', async () => {
  const db = freshDb();
  await addWish(db, wishValue({ name: 'ケニア', process: 'ウォッシュト' }), NOW);
  const text = JSON.stringify(await exportAll(db, NOW));
  await clearAll(db);
  await restoreBackup(db, parseBackup(text));
  assert.equal((await listWishlist(db))[0].name, 'ケニア');

  // 3-1までのファイル（wishlist の表がない）
  const old = makeBackup({ beans: [{ id: 'b1', name: 'グアテマラ', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), deletedAt: null }] }, NOW);
  delete old.tables.wishlist;
  const parsed = parseBackup(JSON.stringify(old));
  assert.deepEqual(parsed.tables.wishlist, []);
  await restoreBackup(db, parsed);
  assert.equal((await listWishlist(db)).length, 1, '今ある気になる豆は消えない');
  db.close();
});
