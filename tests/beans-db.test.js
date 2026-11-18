// 豆と在庫のデータベースの出し入れ（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  openDb,
  addBean,
  updateBean,
  deleteBean,
  getBeanWithTx,
  listBeans,
  recordCupUsage,
  measureBean,
  deleteInventoryTx,
  setBeanStatus,
  exportAll,
  clearAll,
  restoreBackup,
} from '../js/db.js';
import { normalizeBeanInput } from '../js/core/beans.js';
import { remainingG, cupsLeft } from '../js/core/inventory.js';
import { parseBackup } from '../js/core/backup.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const input = (extra = {}) =>
  normalizeBeanInput({ name: 'エチオピア', labelWeightG: '200', labelWeightBasis: 'green', roastLevel: 'シティ', ...extra }).value;

test('完了の確認：豆を登録し、1杯淹れると残量と残り杯数が減る', async () => {
  const db = freshDb();
  const bean = await addBean(db, input(), NOW);
  let { txs } = await getBeanWithTx(db, bean.id);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].kind, 'in');
  assert.equal(remainingG(txs), 164); // 生豆時200g × (1 − 18%)
  assert.equal(cupsLeft(remainingG(txs), 15), 10);

  await recordCupUsage(db, bean.id, 15, later(1));
  ({ txs } = await getBeanWithTx(db, bean.id));
  assert.equal(remainingG(txs), 149);
  assert.equal(cupsLeft(remainingG(txs), 15), 9);
  db.close();
});

test('1杯淹れると、未開封の豆は開封済みになる', async () => {
  const db = freshDb();
  const bean = await addBean(db, input(), NOW);
  assert.equal(bean.status, 'unopened');
  await recordCupUsage(db, bean.id, 15, later(1));
  assert.equal((await getBeanWithTx(db, bean.id)).bean.status, 'open');
  db.close();
});

test('2袋目は、1袋目の実重量から学んだ目減り率で見積もる', async () => {
  const db = freshDb();
  await addBean(db, input({ actualWeightG: '170' }), NOW); // 15%
  const second = await addBean(db, input(), later(1));
  const { txs } = await getBeanWithTx(db, second.id);
  assert.equal(remainingG(txs), 170);
  assert.match(txs[0].memo, /15%/);
  db.close();
});

test('量り直すと差の分だけ調整の履歴が足され、同じ重さなら何もしない', async () => {
  const db = freshDb();
  const bean = await addBean(db, input(), NOW);
  await recordCupUsage(db, bean.id, 15, later(1));
  const tx = await measureBean(db, bean.id, 152.3, later(2));
  assert.equal(tx.kind, 'adjust');
  assert.equal(tx.deltaG, 3.3);
  assert.equal(remainingG((await getBeanWithTx(db, bean.id)).txs), 152.3);
  assert.equal(await measureBean(db, bean.id, 152.3, later(3)), null);
  db.close();
});

test('履歴を取り消すと残量が戻る', async () => {
  const db = freshDb();
  const bean = await addBean(db, input(), NOW);
  const tx = await recordCupUsage(db, bean.id, 15, later(1));
  await deleteInventoryTx(db, tx.id, later(2));
  assert.equal(remainingG((await getBeanWithTx(db, bean.id)).txs), 164);
  db.close();
});

test('編集で実重量を入れると、入庫の量が実重量に直る（ほかの履歴はそのまま）', async () => {
  const db = freshDb();
  const bean = await addBean(db, input(), NOW);
  await recordCupUsage(db, bean.id, 15, later(1));
  await updateBean(db, bean.id, input({ actualWeightG: '166.5' }), later(2));
  const { txs } = await getBeanWithTx(db, bean.id);
  assert.equal(txs.filter((t) => t.kind === 'in').length, 1);
  assert.equal(remainingG(txs), 151.5);
  db.close();
});

test('量り直した後に編集で実重量を入れても、量った残量は変わらない', async () => {
  const db = freshDb();
  const bean = await addBean(db, input(), NOW);
  await recordCupUsage(db, bean.id, 15, later(1));
  await measureBean(db, bean.id, 146.5, later(2));
  await updateBean(db, bean.id, input({ actualWeightG: '166.5' }), later(3));
  assert.equal(remainingG((await getBeanWithTx(db, bean.id)).txs), 146.5);
  db.close();
});

test('削除すると一覧から消え、在庫履歴にも削除の印が付く', async () => {
  const db = freshDb();
  const a = await addBean(db, input(), NOW);
  await addBean(db, input({ name: '別の豆' }), NOW);
  await recordCupUsage(db, a.id, 15, later(1));
  await deleteBean(db, a.id, later(2));
  assert.deepEqual(
    (await listBeans(db)).map((b) => b.name),
    ['別の豆'],
  );
  assert.equal(await getBeanWithTx(db, a.id), null);
  const raw = await db.table('inventoryTx').where('beanId').equals(a.id).toArray();
  assert.ok(raw.length === 2 && raw.every((t) => t.deletedAt));
  db.close();
});

test('飲み切りにできる', async () => {
  const db = freshDb();
  const a = await addBean(db, input(), NOW);
  await setBeanStatus(db, a.id, 'finished', later(1));
  assert.equal((await getBeanWithTx(db, a.id)).bean.status, 'finished');
  db.close();
});

test('豆と在庫履歴は書き出し→全削除→復元で戻り、残量も同じ', async () => {
  const db = freshDb();
  const bean = await addBean(db, input(), NOW);
  await recordCupUsage(db, bean.id, 15, later(1));
  await measureBean(db, bean.id, 140, later(2));
  const text = JSON.stringify(await exportAll(db, later(3)));
  await clearAll(db);
  await restoreBackup(db, parseBackup(text));
  const { bean: restored, txs } = await getBeanWithTx(db, bean.id);
  assert.equal(restored.name, 'エチオピア');
  assert.equal(remainingG(txs), 140);
  db.close();
});
