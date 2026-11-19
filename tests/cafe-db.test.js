// お店で飲んだ1杯（X37、D-188）とデータベース（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from '../vendor/dexie/dexie.mjs';
import { openDb, readAll, addCafeVisit, listCafeVisits, getCafeVisit, updateCafeVisit, deleteCafeVisit, exportAll, clearAll, restoreBackup } from '../js/db.js';
import { normalizeCafeInput } from '../js/core/cafe.js';
import { parseBackup } from '../js/core/backup.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOW = new Date('2026-11-19T07:42:00Z');
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const cafeValue = (raw) => {
  const { value, errors } = normalizeCafeInput({ at: '2026-11-19T10:30', ...raw });
  assert.deepEqual(errors, {});
  return value;
};

test('移行：版6のデータベースを開き直すと、記録はそのままでお店の1杯の表が増える', async () => {
  const indexedDB = new IDBFactory();
  // 3-6 までのアプリが作った版6のデータベース
  const v6 = new Dexie('pourfolio-test', { indexedDB, IDBKeyRange });
  v6.version(1).stores({
    beans: 'id, updatedAt, roastDate',
    inventoryTx: 'id, beanId, brewId, at, updatedAt',
    equipment: 'id, kind, updatedAt',
    recipes: 'id, parentId, updatedAt',
    brews: 'id, at, beanId, recipeId, updatedAt',
    tastings: 'id, brewId, updatedAt',
    settings: 'id',
  });
  v6.version(2).stores({ suggestions: 'id, brewId, beanId, updatedAt' });
  v6.version(3).stores({ orders: 'id, orderDate, updatedAt' });
  v6.version(4).stores({ frozenPortions: 'id, beanId, updatedAt' });
  v6.version(5).stores({ photos: 'id, brewId, updatedAt', experiments: 'id, updatedAt' });
  v6.version(6).stores({ wishlist: 'id, updatedAt' });
  const at = NOW.toISOString();
  const brew = { id: 'brew1', at, beanId: 'bean1', recipeId: null, createdAt: at, updatedAt: at, deletedAt: null };
  const wish = { id: 'w1', name: 'ケニア', createdAt: at, updatedAt: at, deletedAt: null };
  await v6.table('brews').put(brew);
  await v6.table('wishlist').put(wish);
  v6.close();

  const db = openDb('pourfolio-test', { indexedDB, IDBKeyRange });
  await db.open();
  assert.equal(db.verno, 7);
  const all = await readAll(db);
  assert.deepEqual(all.brews, [brew]);
  assert.deepEqual(all.wishlist, [wish]);
  assert.deepEqual(all.cafeVisits, []);
  await addCafeVisit(db, cafeValue({ shopName: 'ほとり' }), NOW);
  assert.equal((await listCafeVisits(db)).length, 1);
  db.close();
});

test('お店の1杯を足す・直す・消す（消すと一覧と1件読みから消え、記録は印で残る）', async () => {
  const db = freshDb();
  const v = await addCafeVisit(db, cafeValue({ shopName: 'ほとり', stars: '4' }), NOW);
  assert.ok(v.id && v.createdAt && v.updatedAt);
  assert.equal(v.deletedAt, null);
  const later = new Date('2026-11-20T00:00:00Z');
  const u = await updateCafeVisit(db, v.id, { memo: 'また行く' }, later);
  assert.equal(u.memo, 'また行く');
  assert.equal(u.updatedAt, later.toISOString());
  assert.equal(u.createdAt, v.createdAt);
  await deleteCafeVisit(db, v.id, later);
  assert.equal(await getCafeVisit(db, v.id), null);
  assert.deepEqual(await listCafeVisits(db), []);
  assert.equal((await db.table('cafeVisits').get(v.id)).deletedAt, later.toISOString());
  await assert.rejects(() => updateCafeVisit(db, v.id, { memo: 'x' }), /見つかりません/);
  db.close();
});

test('書き出し→全削除→復元で、お店の1杯も戻る。版6の書き出しファイル（表がない）も読める', async () => {
  const db = freshDb();
  const v = await addCafeVisit(db, cafeValue({ shopName: 'ほとり' }), NOW);
  const backup = parseBackup(JSON.stringify(await exportAll(db, NOW)));
  await clearAll(db);
  await restoreBackup(db, backup);
  assert.deepEqual(await listCafeVisits(db), [v]);
  const old = JSON.parse(JSON.stringify(backup));
  delete old.tables.cafeVisits;
  assert.deepEqual(parseBackup(JSON.stringify(old)).tables.cafeVisits, []);
  db.close();
});

test('お店の1杯は分析・提案・カフェインに入らない：表を読むのは決めたファイルだけ', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
  const users = walk('js')
    .filter((f) => f.endsWith('.js') && /cafeVisits|CafeVisit/.test(readFileSync(join(root, f), 'utf8')))
    .map((f) => f.split(sep).join('/'))
    .sort();
  // cafe.js（入力の確かめ）・records.js（表の一覧）・backup.js（表の名前）・sample-data.js（確認用）・db.js（読み書き）・画面（cafe-page.js）だけ
  assert.deepEqual(users, ['js/cafe-page.js', 'js/core/backup.js', 'js/core/cafe.js', 'js/core/records.js', 'js/core/sample-data.js', 'js/db.js']);
});
