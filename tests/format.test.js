import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTimeJa, localYmd, formatYmdJa, formatG } from '../js/core/format.js';

test('端末の日付を「年-月-日」で返す', () => {
  assert.equal(localYmd(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(localYmd('bad'), '');
});

test('「年-月-日」を「月/日」で表示する', () => {
  assert.equal(formatYmdJa('2026-11-08'), '11/8');
  assert.equal(formatYmdJa('2026-11-08', { withYear: true }), '2026/11/8');
  assert.equal(formatYmdJa(null), '');
});

test('重さは0.1g単位で、整数なら小数点を付けない', () => {
  assert.equal(formatG(164), '164g');
  assert.equal(formatG(133.84), '133.8g');
  assert.equal(formatG(null), '');
});

test('日時を「年/月/日 時:分」で表示する', () => {
  assert.equal(formatDateTimeJa(new Date(2026, 10, 18, 9, 5)), '2026/11/18 09:05');
});

test('文字列や数値の日時も受け付ける', () => {
  const d = new Date(2026, 0, 2, 23, 59);
  assert.equal(formatDateTimeJa(d.toISOString()), '2026/01/02 23:59');
  assert.equal(formatDateTimeJa(d.getTime()), '2026/01/02 23:59');
});

test('不正な値は空文字を返す', () => {
  assert.equal(formatDateTimeJa('not a date'), '');
  assert.equal(formatDateTimeJa(undefined), '');
});
