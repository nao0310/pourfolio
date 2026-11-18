// 写真（A7）の計算とデータベース（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from '../vendor/dexie/dexie.mjs';
import {
  PHOTO_SLOT_KEYS,
  fitSize,
  isImageDataUrl,
  dataUrlBytes,
  buildPhoto,
  photosOfBrew,
  photoCount,
  photoUsage,
  formatBytes,
  withoutPhotos,
} from '../js/core/photos.js';
import { openDb, saveBrew, savePhoto, deletePhoto, getPhotosForBrew, readAll, exportAll, clearAll, restoreBackup } from '../js/db.js';
import { parseBackup } from '../js/core/backup.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const brewFields = () => ({ at: NOW.toISOString(), beanId: null, recipeId: null, planned: {}, actual: { doseG: 15, waterG: 225, totalSec: 210 } });

test('縮小：長い辺を1280pxまで。縦横比はそのまま、小さい写真は拡大しない', () => {
  assert.deepEqual(fitSize(4032, 3024), { width: 1280, height: 960 });
  assert.deepEqual(fitSize(3024, 4032), { width: 960, height: 1280 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(0, 0), { width: 1, height: 1 });
});

test('画像の data URL だけを受け付け、大きさを数える', () => {
  assert.ok(isImageDataUrl(PNG));
  assert.ok(isImageDataUrl(JPG));
  assert.equal(isImageDataUrl('data:text/html;base64,PGI+'), false);
  assert.equal(isImageDataUrl('javascript:alert(1)'), false);
  assert.equal(isImageDataUrl(null), false);
  assert.equal(dataUrlBytes('data:image/jpeg;base64,AAAA'), 3);
  assert.equal(dataUrlBytes('data:image/jpeg;base64,AAA='), 2);
  assert.equal(formatBytes(350 * 1024), '350KB');
  assert.equal(formatBytes(1.25 * 1024 * 1024), '1.3MB');
});

test('写真の記録：枠は粉・粉の層・抽出液。知らない枠・壊れた画像は保存しない', () => {
  assert.deepEqual(PHOTO_SLOT_KEYS, ['grounds', 'bed', 'liquid']);
  const p = buildPhoto({ brewId: 'b1', slot: 'liquid', dataUrl: PNG, widthPx: 1, heightPx: 1 });
  assert.deepEqual(Object.keys(p), ['brewId', 'slot', 'dataUrl', 'widthPx', 'heightPx', 'bytes']);
  assert.throws(() => buildPhoto({ brewId: 'b1', slot: 'cup', dataUrl: PNG }));
  assert.throws(() => buildPhoto({ brewId: 'b1', slot: 'bed', dataUrl: 'data:text/plain;base64,AA==' }));
  assert.throws(() => buildPhoto({ brewId: '', slot: 'bed', dataUrl: PNG }));
});

test('枠ごとの写真：削除済み・別の抽出・壊れた画像は除き、2枚あれば新しいほう', () => {
  const photos = [
    { id: 'a', brewId: 'b1', slot: 'liquid', dataUrl: PNG, updatedAt: '1', deletedAt: null },
    { id: 'b', brewId: 'b1', slot: 'liquid', dataUrl: JPG, updatedAt: '2', deletedAt: null },
    { id: 'c', brewId: 'b1', slot: 'grounds', dataUrl: null, updatedAt: '3', deletedAt: '3' },
    { id: 'd', brewId: 'b2', slot: 'bed', dataUrl: PNG, updatedAt: '1', deletedAt: null },
    { id: 'e', brewId: 'b1', slot: 'bed', dataUrl: 'data:text/html;base64,AA==', updatedAt: '1', deletedAt: null },
  ];
  const by = photosOfBrew(photos, 'b1');
  assert.equal(by.liquid.id, 'b');
  assert.equal(by.grounds, null);
  assert.equal(by.bed, null);
  assert.equal(photoCount(photos, 'b1'), 1);
  assert.equal(photoUsage(photos).count, 3);
  const backup = { app: 'pourfolio', tables: { photos, brews: [{ id: 'b1' }] } };
  const out = withoutPhotos(backup);
  assert.deepEqual(out.tables.photos, []);
  assert.equal(backup.tables.photos.length, 5); // 元は変えない
  assert.deepEqual(out.tables.brews, [{ id: 'b1' }]);
});

test('保存：同じ枠に撮り直すと、古い写真は画像を消して削除の印。消すと画像も消える', async () => {
  const db = freshDb();
  const { brew } = await saveBrew(db, brewFields(), NOW);
  const first = await savePhoto(db, { brewId: brew.id, slot: 'liquid', dataUrl: PNG, widthPx: 1, heightPx: 1 }, later(1));
  const second = await savePhoto(db, { brewId: brew.id, slot: 'liquid', dataUrl: JPG, widthPx: 2, heightPx: 2 }, later(2));
  await savePhoto(db, { brewId: brew.id, slot: 'grounds', dataUrl: PNG, widthPx: 1, heightPx: 1 }, later(3));
  const by = await getPhotosForBrew(db, brew.id);
  assert.equal(by.liquid.id, second.id);
  assert.equal(by.grounds.slot, 'grounds');
  const old = (await readAll(db)).photos.find((p) => p.id === first.id);
  assert.equal(old.dataUrl, null);
  assert.equal(old.deletedAt, later(2).toISOString());

  await deletePhoto(db, second.id, later(4));
  assert.equal((await getPhotosForBrew(db, brew.id)).liquid, null);
  assert.equal((await readAll(db)).photos.find((p) => p.id === second.id).dataUrl, null);
  await assert.rejects(savePhoto(db, { brewId: 'nope', slot: 'bed', dataUrl: PNG }, later(5)));
});

test('書き出し→全削除→復元で写真が戻る。写真の表がない古いファイルも復元できる', async () => {
  const db = freshDb();
  const { brew } = await saveBrew(db, brewFields(), NOW);
  await savePhoto(db, { brewId: brew.id, slot: 'bed', dataUrl: PNG, widthPx: 1, heightPx: 1 }, later(1));
  const backup = parseBackup(JSON.stringify(await exportAll(db, later(2))));
  await clearAll(db);
  await restoreBackup(db, backup);
  assert.equal((await getPhotosForBrew(db, brew.id)).bed.dataUrl, PNG);

  const old = JSON.parse(JSON.stringify(backup));
  delete old.tables.photos;
  delete old.tables.experiments;
  await clearAll(db);
  await restoreBackup(db, parseBackup(JSON.stringify(old)));
  assert.equal((await readAll(db)).brews.length, 1);
  assert.deepEqual((await readAll(db)).photos, []);
});

test('移行：版4のデータベースを開き直すと、記録はそのままで写真と飲み比べの表が増える', async () => {
  const indexedDB = new IDBFactory();
  const v4 = new Dexie('pourfolio-test', { indexedDB, IDBKeyRange });
  v4.version(1).stores({
    beans: 'id, updatedAt, roastDate',
    inventoryTx: 'id, beanId, brewId, at, updatedAt',
    equipment: 'id, kind, updatedAt',
    recipes: 'id, parentId, updatedAt',
    brews: 'id, at, beanId, recipeId, updatedAt',
    tastings: 'id, brewId, updatedAt',
    settings: 'id',
  });
  v4.version(2).stores({ suggestions: 'id, brewId, beanId, updatedAt' });
  v4.version(3).stores({ orders: 'id, orderDate, updatedAt' });
  v4.version(4).stores({ frozenPortions: 'id, beanId, updatedAt' });
  const at = NOW.toISOString();
  const brew = { id: 'br1', ...brewFields(), createdAt: at, updatedAt: at, deletedAt: null };
  const tasting = { id: 't1', brewId: 'br1', by: 'me', stage: 'warm', stars: 4, tags: [], jar: {}, memo: '', createdAt: at, updatedAt: at, deletedAt: null };
  const portion = { id: 'p1', beanId: 'x', labelNo: 1, grams: 15, createdAt: at, updatedAt: at, deletedAt: null };
  await v4.table('brews').put(brew);
  await v4.table('tastings').put(tasting);
  await v4.table('frozenPortions').put(portion);
  v4.close();

  const db = openDb('pourfolio-test', { indexedDB, IDBKeyRange });
  await db.open();
  assert.equal(db.verno, 5);
  const all = await readAll(db);
  assert.deepEqual(all.brews, [brew]);
  assert.deepEqual(all.tastings, [tasting]); // 2-3までの評価は書き換えない
  assert.deepEqual(all.frozenPortions, [portion]);
  assert.deepEqual(all.photos, []);
  assert.deepEqual(all.experiments, []);
  await savePhoto(db, { brewId: 'br1', slot: 'liquid', dataUrl: PNG, widthPx: 1, heightPx: 1 }, later(1));
  assert.equal((await getPhotosForBrew(db, 'br1')).liquid.slot, 'liquid');
});
