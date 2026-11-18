// ホーム（E1）と保存の促し（G2）の計算
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backupReminder,
  lastBackupText,
  freshnessBand,
  beanRows,
  alertText,
  recordSec,
  recentBrews,
  BACKUP_REMIND_DAYS,
  BACKUP_REMIND_BREWS,
} from '../js/core/home.js';
import { freshness } from '../js/core/freshness.js';

// 日付の境目がどの時間帯でも同じになるよう、日本時間の昼（UTCの3時）を使う
const NOW = new Date('2026-11-18T03:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const brew = (id, createdAt, extra = {}) => ({ id, at: createdAt, createdAt, deletedAt: null, ...extra });

test('保存の促し：7日たったら促す（6日は促さない）', () => {
  assert.equal(BACKUP_REMIND_DAYS, 7);
  assert.equal(backupReminder({ lastBackupAt: daysAgo(6), now: NOW }).due, false);
  const r = backupReminder({ lastBackupAt: daysAgo(7), now: NOW });
  assert.equal(r.due, true);
  assert.equal(r.daysSince, 7);
  assert.equal(r.reason, '前回の書き出しから7日たちました');
});

test('保存の促し：書き出し後に10杯記録したら促す（9杯は促さない、書き出し前の杯と削除済みは数えない）', () => {
  assert.equal(BACKUP_REMIND_BREWS, 10);
  const last = daysAgo(2);
  const after = Array.from({ length: 9 }, (_, i) => brew(`a${i}`, daysAgo(1)));
  const before = [brew('old', daysAgo(3))];
  const deleted = [{ ...brew('del', daysAgo(1)), deletedAt: daysAgo(1) }];
  const nine = backupReminder({ lastBackupAt: last, brews: [...after, ...before, ...deleted], now: NOW });
  assert.equal(nine.brewsSince, 9);
  assert.equal(nine.due, false);
  const ten = backupReminder({ lastBackupAt: last, brews: [...after, brew('a9', daysAgo(1))], now: NOW });
  assert.equal(ten.due, true);
  assert.equal(ten.reason, '前回の書き出しから10杯記録しました');
});

test('保存の促し：一度も書き出していなければ、記録が1件でもあれば促す', () => {
  assert.equal(backupReminder({ lastBackupAt: null, brews: [], hasRecords: false, now: NOW }).due, false);
  assert.equal(backupReminder({ lastBackupAt: null, brews: [], hasRecords: true, now: NOW }).due, true);
  const r = backupReminder({ lastBackupAt: null, brews: [brew('a', daysAgo(1))], now: NOW });
  assert.equal(r.due, true);
  assert.equal(r.never, true);
  assert.equal(r.reason, 'まだ一度も書き出していません');
});

test('最後の書き出しの1行', () => {
  assert.equal(lastBackupText(null, NOW), '最後の書き出し：まだありません');
  assert.equal(lastBackupText(NOW.toISOString(), NOW), '最後の書き出し：11/18（今日）');
  assert.equal(lastBackupText(daysAgo(8), NOW), '最後の書き出し：11/10（8日前）');
});

test('飲み頃の帯：幅の合計は1、今日の位置は0〜1に収まる', () => {
  const f = freshness('2026-11-12', 'シティ', '2026-11-18');
  const band = freshnessBand(f);
  const sum = band.segments.reduce((s, x) => s + x.share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.deepEqual(band.segments.map((s) => s.stage), ['resting', 'peak', 'past', 'useSoon']);
  // 今日の位置は「飲み頃」の幅の中
  const [rest, peak] = band.segments;
  assert.ok(band.pos > rest.share && band.pos < rest.share + peak.share);
  // 焙煎日が未来なら左端、ずっと前なら右端
  assert.equal(freshnessBand(freshness('2026-11-25', 'シティ', '2026-11-18')).pos, 0);
  assert.equal(freshnessBand(freshness('2025-01-01', 'シティ', '2026-11-18')).pos, 1);
  // 焙煎日がなければ帯は出さない
  assert.equal(freshnessBand(freshness('', 'シティ', '2026-11-18')), null);
});

const tx = (beanId, deltaG, extra = {}) => ({ id: `${beanId}-${deltaG}`, beanId, deltaG, kind: 'in', at: daysAgo(5), deletedAt: null, ...extra });
const bean = (id, extra = {}) => ({ id, name: id, roastLevel: 'シティ', roastDate: '2026-11-10', status: 'open', createdAt: daysAgo(9), deletedAt: null, ...extra });

test('在庫アラート：残り3杯以下（4杯は出さない）と、早めに消費', () => {
  const rows = beanRows({
    beans: [
      bean('four', { roastDate: '2026-11-12' }),
      bean('three', { roastDate: '2026-11-11' }),
      bean('zero', { roastDate: '2026-11-09' }),
      bean('old', { roastDate: '2026-09-01' }),
      bean('noDate', { roastDate: '' }),
    ],
    txs: [tx('four', 60), tx('three', 45), tx('zero', 15), tx('zero', -15, { kind: 'brew' }), tx('old', 200), tx('noDate', 100)],
    doseG: 15,
    today: '2026-11-18',
  });
  const by = Object.fromEntries(rows.map((r) => [r.bean.id, r]));
  assert.deepEqual(by.four.alerts, []);
  assert.deepEqual(by.three.alerts, ['low']);
  assert.equal(alertText(by.three), '残り3杯');
  assert.deepEqual(by.zero.alerts, ['empty']);
  assert.match(alertText(by.zero), /残りがありません/);
  assert.deepEqual(by.old.alerts, ['useSoon']);
  assert.match(alertText(by.old), /早めに消費（焙煎から\d+日）/);
  assert.equal(by.noDate.band, null);
  assert.equal(by.noDate.freshness, null);
});

test('ホームの豆：飲み切り・入荷待ち・削除済みは出さない。削除した在庫履歴は数えない', () => {
  const rows = beanRows({
    beans: [bean('a'), bean('done', { status: 'finished' }), bean('wait', { status: 'ordered' }), bean('gone', { deletedAt: daysAgo(1) })],
    txs: [tx('a', 100), tx('a', -50, { kind: 'brew', deletedAt: daysAgo(1) })],
    doseG: 15,
    today: '2026-11-18',
  });
  assert.deepEqual(rows.map((r) => r.bean.id), ['a']);
  assert.equal(rows[0].remainingG, 100);
  assert.equal(rows[0].cups, 6);
});

test('記録にかかった時間：落ち切ってから評価を保存するまで（タイマーを使った抽出だけ）', () => {
  const b = { at: '2026-11-18T07:00:00.000Z', timerUsed: true, actual: { totalSec: 210 } };
  const t = { createdAt: '2026-11-18T07:03:54.000Z' }; // 落ち切り 07:03:30 から24秒
  assert.equal(recordSec(b, t), 24);
  assert.equal(recordSec({ ...b, timerUsed: false }, t), null);
  assert.equal(recordSec(b, null), null);
  assert.equal(recordSec(b, { createdAt: '2026-11-18T09:00:00.000Z' }), null); // あとで評価した
  assert.equal(recordSec(b, { createdAt: '2026-11-18T07:03:00.000Z' }), null); // 総時間を長めに直した
});

test('直近の抽出：新しい順に3杯、評価と記録の時間を添える', () => {
  const brews = [1, 2, 3, 4].map((i) => brew(`b${i}`, daysAgo(5 - i)));
  brews.push({ ...brew('del', daysAgo(0)), deletedAt: daysAgo(0) });
  const tastings = [{ id: 't4', brewId: 'b4', by: 'me', stage: 'warm', stars: 4, deletedAt: null, updatedAt: daysAgo(1), createdAt: daysAgo(1) }];
  const list = recentBrews(brews, tastings);
  assert.deepEqual(list.map((x) => x.brew.id), ['b4', 'b3', 'b2']);
  assert.equal(list[0].tasting.stars, 4);
  assert.equal(list[1].tasting, null);
  assert.equal(list[0].recordSec, null);
});
