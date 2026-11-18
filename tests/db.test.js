// 本物に近い IndexedDB（fake-indexeddb、テスト専用）で、データベースの出し入れを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openDb, readAll, exportAll, restoreBackup, clearAll, putAll, countAlive, getSettings, updateSettings, setDeviceSettings } from '../js/db.js';
import { parseBackup } from '../js/core/backup.js';
import { makeSampleData } from '../js/core/sample-data.js';
import { TABLES, markDeleted, SETTINGS_ID } from '../js/core/records.js';

const NOW = new Date('2026-11-18T07:42:00Z');
// テストごとに新しい空のデータベースを使う
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const byId = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

test('完了の確認：書き出し→全削除→復元で1件も欠けない', async () => {
  const db = freshDb();
  const sample = makeSampleData(NOW);
  // 削除の印が付いた記録も書き出し・復元の対象になる
  sample.beans.push(markDeleted({ ...sample.beans[0], id: 'deleted-bean' }, NOW));
  await putAll(db, sample);
  const before = await readAll(db);

  const text = JSON.stringify(await exportAll(db, NOW));
  await clearAll(db);
  for (const n of Object.values(await countAlive(db))) assert.equal(n, 0);

  const result = await restoreBackup(db, parseBackup(text));
  const after = await readAll(db);

  for (const name of TABLES) {
    assert.ok(before[name].length > 0, `${name} にサンプルがある`);
    assert.deepEqual(byId(after[name]), byId(before[name]), name);
    assert.equal(result[name].added, before[name].length, name);
  }
  db.close();
});

test('同じファイルをもう一度復元しても増えない', async () => {
  const db = freshDb();
  await putAll(db, makeSampleData(NOW));
  const backup = parseBackup(JSON.stringify(await exportAll(db, NOW)));
  const result = await restoreBackup(db, backup);
  for (const name of TABLES) {
    assert.equal(result[name].added, 0);
    assert.equal(result[name].updated, 0);
  }
  assert.deepEqual(byId((await readAll(db)).beans), byId(backup.tables.beans));
  db.close();
});

test('復元は統合：端末で後から変えた記録は古いファイルで上書きされない', async () => {
  const db = freshDb();
  const sample = makeSampleData(NOW);
  await putAll(db, sample);
  const oldBackup = parseBackup(await exportAll(db, NOW));

  const bean = sample.beans[0];
  await db.table('beans').put({ ...bean, name: '端末で直した名前', updatedAt: '2026-11-19T00:00:00.000Z' });
  await db.table('brews').put({ id: 'new-brew', updatedAt: '2026-11-19T00:00:00.000Z', deletedAt: null });

  await restoreBackup(db, oldBackup);
  assert.equal((await db.table('beans').get(bean.id)).name, '端末で直した名前');
  assert.ok(await db.table('brews').get('new-brew'));
  db.close();
});

test('件数は削除の印が付いたものを数えない', async () => {
  const db = freshDb();
  const sample = makeSampleData(NOW);
  sample.beans.push(markDeleted({ ...sample.beans[0], id: 'deleted-bean' }, NOW));
  await putAll(db, sample);
  const counts = await countAlive(db);
  assert.equal(counts.beans, 1);
  assert.equal(counts.equipment, 2);
  db.close();
});

test('設定は固定IDの1件。なければ作り、一部だけ変えられる', async () => {
  const db = freshDb();
  const s = await getSettings(db, NOW);
  assert.equal(s.id, SETTINGS_ID);
  assert.equal(s.lastBackupAt, null);
  const later = new Date('2026-11-20T00:00:00Z');
  const u = await updateSettings(db, { lastBackupAt: later.toISOString() }, later);
  assert.equal(u.lastBackupAt, '2026-11-20T00:00:00.000Z');
  assert.equal(u.createdAt, s.createdAt);
  assert.equal(await db.table('settings').count(), 1);
  db.close();
});

test('新しい端末で、ホームを開いてから復元しても、ファイルの設定が入る。最後に見た版は今の端末の値を残す（2-8 の6番）', async () => {
  // 古い端末：粉量とカフェインの時刻を決めて書き出す
  const oldDb = freshDb();
  await updateSettings(oldDb, { defaultDoseG: 18, caffeineCutoff: '15:00' }, NOW);
  await setDeviceSettings(oldDb, { lastSeenVersion: '2.6' });
  const file = parseBackup(JSON.stringify(await exportAll(oldDb, NOW)));
  oldDb.close();
  // 新しい端末：ホームを開く（設定ができ、最後に見た版を覚える）→ 復元
  const db = freshDb();
  await getSettings(db, new Date('2026-11-25T00:00:00Z'));
  await setDeviceSettings(db, { lastSeenVersion: '2.8' });
  const result = await restoreBackup(db, file);
  assert.equal(result.settings.updated, 1);
  const s = await getSettings(db);
  assert.equal(s.defaultDoseG, 18);
  assert.equal(s.caffeineCutoff, '15:00');
  assert.equal(s.lastSeenVersion, '2.8');
  db.close();
});

test('端末だけの設定を変えても updatedAt は進まない。それ以外の項目は端末だけの設定として変えられない', async () => {
  const db = freshDb();
  const s = await getSettings(db, NOW);
  assert.equal(s.updatedAt, new Date(0).toISOString());
  const n = await setDeviceSettings(db, { lastSeenVersion: '2.8' });
  assert.equal(n.updatedAt, s.updatedAt);
  await assert.rejects(setDeviceSettings(db, { defaultDoseG: 20 }));
  db.close();
});
