// カレンダーとカフェイン（E8）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dailyStats, cupLevel, monthGrid, shiftMonth, lastDays, caffeineSummary } from '../js/core/calendar.js';

const row = (ymd, caffeineMg) => ({ ymd, metrics: { caffeineMg } });

test('日付の足し算（月またぎ・年またぎ・うるう年）', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});

test('日ごとの集計：カフェインを出せない杯は数を別に持つ', () => {
  const s = dailyStats([row('2026-11-18', 90), row('2026-11-18', 120), row('2026-11-17', null)]);
  assert.deepEqual(s.get('2026-11-18'), { cups: 2, caffeineMg: 210, unknown: 0 });
  assert.deepEqual(s.get('2026-11-17'), { cups: 1, caffeineMg: 0, unknown: 1 });
  assert.equal(cupLevel(0), 0);
  assert.equal(cupLevel(7), 4);
});

test('月のカレンダー：日曜はじまり、月の外の日も埋める', () => {
  const stats = dailyStats([row('2026-11-18', 90)]);
  const weeks = monthGrid(2026, 11, stats); // 2026-11-01 は日曜
  assert.equal(weeks[0][0].ymd, '2026-11-01');
  assert.equal(weeks.length, 5);
  assert.equal(weeks[4][6].ymd, '2026-12-05');
  assert.equal(weeks[4][6].inMonth, false);
  const d18 = weeks.flat().find((d) => d.ymd === '2026-11-18');
  assert.deepEqual([d18.cups, d18.caffeineMg, d18.level], [1, 90, 1]);
  const feb = monthGrid(2026, 2); // 2026-02-01 は日曜、28日で4週ちょうど
  assert.equal(feb.length, 4);
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});

test('直近の日々と要約', () => {
  const stats = dailyStats([row('2026-11-18', 100), row('2026-11-16', 200), row('2026-11-16', 100), row('2026-10-01', 500)]);
  const days = lastDays(stats, '2026-11-18', 3);
  assert.deepEqual(days.map((d) => d.ymd), ['2026-11-16', '2026-11-17', '2026-11-18']);
  const s = caffeineSummary(days);
  assert.equal(s.drankDays, 2);
  assert.equal(s.avgMg, 200);
  assert.equal(s.maxDay.ymd, '2026-11-16');
  assert.equal(s.avgCups, 1.5);
  assert.equal(s.todayMg, 100);
  assert.equal(caffeineSummary(lastDays(new Map(), '2026-11-18', 3)).avgMg, null);
});
