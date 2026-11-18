// おすそ分け記録（X34）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  normalizeGiftInput,
  normalizeFeedback,
  recipientSuggestions,
  giftRows,
  giftTotals,
  giftTxNote,
  recipientKey,
  NO_RECIPIENT,
  FEEDBACK_MAX,
} from '../js/core/gift.js';
import { openDb, addBean, addGift, setGiftFeedback, getBeanWithTx, deleteInventoryTx, exportAll, clearAll, restoreBackup, listAliveTx, setBeanStatus } from '../js/db.js';
import { normalizeBeanInput } from '../js/core/beans.js';
import { remainingG } from '../js/core/inventory.js';
import { parseBackup } from '../js/core/backup.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const freshDb = () => openDb('pourfolio-gift-test', { indexedDB: new IDBFactory(), IDBKeyRange });
const beanInput = (extra = {}) => normalizeBeanInput({ name: 'エチオピア', labelWeightG: '200', labelWeightBasis: 'green', roastLevel: 'シティ', ...extra }).value;
const tx = (o) => ({ id: o.id ?? `t${Math.random()}`, kind: 'gift', deltaG: -20, at: '2026-11-01T10:00:00Z', createdAt: '2026-11-01T10:00:00Z', deletedAt: null, beanId: 'b1', ...o });

test('入力：量は0より大きく5000g以下、名前とメモは空白を整える', () => {
  assert.deepEqual(normalizeGiftInput({ g: '３０', recipient: '  田中　さん ', memo: '' }), { value: { g: 30, recipient: '田中 さん', memo: '' }, errors: {} });
  assert.equal(normalizeGiftInput({ g: '25.55' }).value.g, 25.6);
  for (const g of ['', '0', '-5', 'abc', '5001']) assert.ok(normalizeGiftInput({ g }).errors.g, g);
  assert.ok(normalizeGiftInput({ g: '10', recipient: 'あ'.repeat(31) }).errors.recipient);
  assert.ok(normalizeGiftInput({ g: '10', memo: 'あ'.repeat(201) }).errors.memo);
});

test('感想：前後の空白を除き、長すぎれば知らせる', () => {
  assert.deepEqual(normalizeFeedback('  おいしかった\r\nまた欲しい '), { value: 'おいしかった\nまた欲しい', error: '' });
  assert.equal(normalizeFeedback('').value, '');
  assert.ok(normalizeFeedback('あ'.repeat(FEEDBACK_MAX + 1)).error);
});

test('名前の候補：回数の多い順、同じ人の書き方の違いはまとめて最後の書き方', () => {
  const txs = [
    tx({ recipient: '母', at: '2026-10-01T00:00:00Z' }),
    tx({ recipient: 'ﾀﾅｶさん', at: '2026-10-02T00:00:00Z' }),
    tx({ recipient: 'タナカ さん', at: '2026-10-05T00:00:00Z' }),
    tx({ recipient: '同僚', at: '2026-11-01T00:00:00Z' }),
    tx({ recipient: '', at: '2026-11-02T00:00:00Z' }),
    tx({ recipient: '消した人', deletedAt: '2026-11-03T00:00:00Z' }),
    { ...tx({ recipient: '廃棄' }), kind: 'discard' },
  ];
  assert.deepEqual(recipientSuggestions(txs), ['タナカ さん', '同僚', '母']);
  assert.equal(recipientKey('タナカ さん'), recipientKey('ﾀﾅｶさん'));
});

test('一覧と相手ごとの合計：新しい順、相手のない古い記録は最後の行', () => {
  const beans = [
    { id: 'b1', name: 'エチオピア', deletedAt: null },
    { id: 'b2', name: 'ケニア', deletedAt: '2026-11-10T00:00:00Z' },
  ];
  const txs = [
    tx({ id: 'a', recipient: '母', deltaG: -30, at: '2026-10-01T00:00:00Z', feedback: 'おいしい' }),
    tx({ id: 'b', recipient: '母', deltaG: -20.5, at: '2026-11-01T00:00:00Z', beanId: 'b2' }),
    tx({ id: 'c', recipient: undefined, deltaG: -15, at: '2026-11-05T00:00:00Z' }), // 3-5 より前の記録
    tx({ id: 'd', recipient: '同僚', deltaG: -10, at: '2026-11-06T00:00:00Z', beanId: 'gone' }),
  ];
  const rows = giftRows({ txs, beans });
  assert.deepEqual(rows.map((r) => r.tx.id), ['d', 'c', 'b', 'a']);
  assert.equal(rows[0].beanName, '（消した豆）');
  assert.equal(rows[2].beanName, 'ケニア');
  assert.equal(rows[2].beanAlive, false);
  const totals = giftTotals(rows);
  assert.deepEqual(
    totals.map((t) => [t.name, t.count, t.totalG, t.feedbacks, t.none]),
    [
      ['母', 2, 50.5, 1, false],
      ['同僚', 1, 10, 0, false],
      [NO_RECIPIENT, 1, 15, 0, true],
    ],
  );
  assert.deepEqual(totals[0].beans, ['ケニア', 'エチオピア']);
  assert.equal(giftTxNote({ recipient: '母', memo: '100g袋で' }), '→ 母　100g袋で');
  assert.equal(giftTxNote({}), '');
});

test('DB：おすそ分けで在庫が減り、未開封は開封済みに。感想を書き足せて、取り消しもできる', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  const gift = await addGift(db, { beanId: bean.id, g: 30, recipient: '母', memo: '' }, later(1));
  let found = await getBeanWithTx(db, bean.id);
  assert.equal(remainingG(found.txs), 134);
  assert.equal(found.bean.status, 'open');
  assert.equal(gift.kind, 'gift');
  assert.equal(gift.recipient, '母');

  const withFb = await setGiftFeedback(db, gift.id, '酸味が好きだって', later(60));
  assert.equal(withFb.feedback, '酸味が好きだって');
  assert.equal(withFb.feedbackAt, later(60).toISOString());
  const cleared = await setGiftFeedback(db, gift.id, '', later(61));
  assert.equal(cleared.feedback, '');
  assert.equal(cleared.feedbackAt, null);

  await deleteInventoryTx(db, gift.id, later(2));
  found = await getBeanWithTx(db, bean.id);
  assert.equal(remainingG(found.txs), 164);
  await assert.rejects(setGiftFeedback(db, gift.id, 'x', later(3)));
  const inbound = found.txs.find((t) => t.kind === 'in');
  await assert.rejects(setGiftFeedback(db, inbound.id, 'x', later(3)));
  await assert.rejects(addGift(db, { beanId: 'no-such', g: 10 }, later(4)));
});

test('DB：飲み切りの豆の状態は変えない。書き出し → 復元で相手と感想が残る', async () => {
  const db = freshDb();
  const bean = await addBean(db, beanInput(), NOW);
  await setBeanStatus(db, bean.id, 'finished', later(1));
  const gift = await addGift(db, { beanId: bean.id, g: 12.5, recipient: '同僚', memo: 'ドリップバッグで' }, later(2));
  await setGiftFeedback(db, gift.id, 'すっきり', later(3));
  assert.equal((await getBeanWithTx(db, bean.id)).bean.status, 'finished');
  const backup = await exportAll(db, later(4));
  await clearAll(db);
  await restoreBackup(db, parseBackup(JSON.stringify(backup)));
  const restored = (await listAliveTx(db)).find((t) => t.id === gift.id);
  assert.deepEqual([restored.recipient, restored.memo, restored.feedback, restored.deltaG], ['同僚', 'ドリップバッグで', 'すっきり', -12.5]);
});
