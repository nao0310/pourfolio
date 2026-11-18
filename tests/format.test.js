import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTimeJa } from '../js/core/format.js';

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
