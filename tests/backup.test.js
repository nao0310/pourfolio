import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeBackup,
  parseBackup,
  mergeRecords,
  backupFileName,
  countRecords,
  totalRecords,
  BackupError,
  FORMAT_VERSION,
} from '../js/core/backup.js';
import { TABLES } from '../js/core/records.js';
import { makeSampleData } from '../js/core/sample-data.js';

const NOW = new Date('2026-11-18T07:42:00Z');

test('書き出しには版番号と全部の表が入る', () => {
  const b = makeBackup({ beans: [{ id: 'a' }] }, NOW);
  assert.equal(b.app, 'pourfolio');
  assert.equal(b.formatVersion, FORMAT_VERSION);
  assert.equal(b.exportedAt, '2026-11-18T07:42:00.000Z');
  assert.deepEqual(Object.keys(b.tables), TABLES);
  assert.deepEqual(b.tables.beans, [{ id: 'a' }]);
  assert.deepEqual(b.tables.brews, []);
});

test('書き出し→JSON→読み込みで中身が変わらない', () => {
  const b = makeBackup(makeSampleData(NOW), NOW);
  const parsed = parseBackup(JSON.stringify(b));
  assert.deepEqual(parsed, b);
});

test('サンプルデータは全部の表に記録がある', () => {
  const counts = countRecords(makeSampleData(NOW));
  for (const name of TABLES) assert.ok(counts[name] > 0, name);
});

test('全部の表を合わせた件数。空のファイルは0件', () => {
  assert.equal(totalRecords(makeSampleData(NOW)), 17); // 写真と飲み比べ（版5）で2件、気になる豆（版6）で1件増えた
  const empty = parseBackup(JSON.stringify(makeBackup({}, NOW)));
  assert.equal(totalRecords(empty.tables), 0);
});

test('ファイル名は日時入り', () => {
  const d = new Date(2026, 10, 18, 7, 5);
  assert.equal(backupFileName(d), 'pourfolio-backup-20261118-0705.json');
});

test('壊れたファイルや別のファイルは理由つきで断る', () => {
  const bad = [
    ['{こわれた', /JSON/],
    [JSON.stringify({ app: 'other', formatVersion: 1, tables: {} }), /Pourfolioの書き出しファイルではありません/],
    [JSON.stringify([1, 2]), /Pourfolioの書き出しファイルではありません/],
    [JSON.stringify({ app: 'pourfolio', formatVersion: 'x', tables: {} }), /版が分かりません/],
    [JSON.stringify({ app: 'pourfolio', formatVersion: 99, tables: {} }), /新しい版/],
    [JSON.stringify({ app: 'pourfolio', formatVersion: 1 }), /記録が入っていません/],
    [JSON.stringify({ app: 'pourfolio', formatVersion: 1, tables: { beans: {} } }), /beans/],
    [JSON.stringify({ app: 'pourfolio', formatVersion: 1, tables: { brews: [{ id: 'a' }, { x: 1 }] } }), /brews.*2件目/],
  ];
  for (const [text, msg] of bad) {
    assert.throws(() => parseBackup(text), (e) => e instanceof BackupError && msg.test(e.message), text);
  }
});

test('ない表は空として読む', () => {
  const p = parseBackup({ app: 'pourfolio', formatVersion: 1, tables: { beans: [{ id: 'a' }] } });
  assert.deepEqual(p.tables.brews, []);
  assert.deepEqual(p.tables.beans, [{ id: 'a' }]);
});

test('古い版のファイルは移行処理で今の形式に直す', () => {
  const migrations = {
    1: (b) => ({ ...b, formatVersion: 2, tables: { ...b.tables, beans: b.tables.beans.map((x) => ({ ...x, v2: true })) } }),
  };
  const old = { app: 'pourfolio', formatVersion: 1, tables: { beans: [{ id: 'a' }] } };
  const p = parseBackup(old, { migrations, currentVersion: 2 });
  assert.equal(p.formatVersion, 2);
  assert.deepEqual(p.tables.beans, [{ id: 'a', v2: true }]);
  assert.throws(() => parseBackup(old, { migrations: {}, currentVersion: 2 }), /直す方法がありません/);
});

test('統合：新しいほうを残し、片方にしかない記録も消えない', () => {
  const existing = [
    { id: 'a', updatedAt: '2026-11-01T00:00:00Z', v: 'こちらが古い' },
    { id: 'b', updatedAt: '2026-11-05T00:00:00Z', v: 'こちらが新しい' },
    { id: 'c', updatedAt: '2026-11-01T00:00:00Z', v: '同じ' },
  ];
  const incoming = [
    { id: 'a', updatedAt: '2026-11-02T00:00:00Z', v: 'ファイルが新しい' },
    { id: 'b', updatedAt: '2026-11-04T00:00:00Z', v: 'ファイルが古い' },
    { id: 'c', updatedAt: '2026-11-01T00:00:00Z', v: '同じ' },
    { id: 'd', updatedAt: '2026-11-01T00:00:00Z', v: 'ファイルだけ' },
  ];
  const r = mergeRecords(existing, incoming);
  assert.deepEqual(
    r.toPut.map((x) => x.v),
    ['ファイルが新しい', 'ファイルだけ'],
  );
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.skipped, 2);
});

test('統合：今ある側が空（undefined入り）でも全部足す', () => {
  const r = mergeRecords([undefined, undefined], [{ id: 'a' }, { id: 'b' }]);
  assert.equal(r.added, 2);
  assert.equal(r.toPut.length, 2);
});
