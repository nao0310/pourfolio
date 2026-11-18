import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, updateRecord, markDeleted, isAlive, newId, TABLES } from '../js/core/records.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('新しい記録にUUIDと3つの日時が付く', () => {
  const now = new Date('2026-11-18T07:42:00Z');
  const r = createRecord({ name: '豆A', doseG: 20 }, now);
  assert.match(r.id, UUID);
  assert.equal(r.createdAt, '2026-11-18T07:42:00.000Z');
  assert.equal(r.updatedAt, '2026-11-18T07:42:00.000Z');
  assert.equal(r.deletedAt, null);
  assert.equal(r.name, '豆A');
  assert.equal(r.doseG, 20);
});

test('IDは毎回ちがう。指定したIDはそのまま使う', () => {
  assert.notEqual(newId(), newId());
  assert.equal(createRecord({ id: 'app' }).id, 'app');
});

test('更新すると updatedAt だけが変わり、元の記録は変わらない', () => {
  const r = createRecord({ name: '豆A' }, '2026-11-01T00:00:00Z');
  const u = updateRecord(r, { name: '豆B', id: 'x', createdAt: 'y' }, '2026-11-02T00:00:00Z');
  assert.equal(u.name, '豆B');
  assert.equal(u.id, r.id);
  assert.equal(u.createdAt, r.createdAt);
  assert.equal(u.updatedAt, '2026-11-02T00:00:00.000Z');
  assert.equal(r.name, '豆A');
});

test('削除は印を付けるだけ', () => {
  const r = createRecord({ name: '豆A' }, '2026-11-01T00:00:00Z');
  const d = markDeleted(r, '2026-11-03T00:00:00Z');
  assert.equal(d.deletedAt, '2026-11-03T00:00:00.000Z');
  assert.equal(d.updatedAt, '2026-11-03T00:00:00.000Z');
  assert.equal(d.name, '豆A');
  assert.equal(isAlive(r), true);
  assert.equal(isAlive(d), false);
});

test('表の一覧（版2で提案、版3で注文、版4で冷凍、版5で写真と飲み比べ、版6で気になる豆を足した）', () => {
  assert.deepEqual(TABLES, ['beans', 'inventoryTx', 'equipment', 'recipes', 'brews', 'tastings', 'suggestions', 'orders', 'frozenPortions', 'photos', 'experiments', 'wishlist', 'settings']);
});
