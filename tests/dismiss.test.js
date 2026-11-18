// お知らせのカードを閉じたことの記憶（2-8 の2番）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dismissKey, dismiss, isDismissed, prune, DISMISS_RULES, FORGET_DAYS } from '../js/core/dismiss.js';

const NOW = new Date('2026-11-18T03:00:00Z');
const later = (days) => new Date(NOW.getTime() + days * 86400000);

test('キー：種類とその杯のIDをつなぐ。IDがなければ種類だけ。知らない種類はエラー', () => {
  assert.equal(dismissKey('cool', 'b1'), 'cool:b1');
  assert.equal(dismissKey('backup'), 'backup');
  assert.throws(() => dismissKey('nope'));
});

test('杯ごとのカード（冷めた味）：閉じた杯ではもう出さず、別の杯なら出す', () => {
  const m = dismiss({}, dismissKey('cool', 'b1'), NOW);
  assert.equal(isDismissed(m, 'cool:b1', NOW), true);
  assert.equal(isDismissed(m, 'cool:b1', later(10)), true);
  assert.equal(isDismissed(m, 'cool:b2', NOW), false);
});

test('日数のカード：書き出しは7日後、自動保存と飲み比べは1日後にまた出す', () => {
  let m = dismiss({}, 'backup', NOW);
  assert.equal(isDismissed(m, 'backup', later(6.9)), true);
  assert.equal(isDismissed(m, 'backup', later(7)), false);
  m = dismiss({}, 'autosave', NOW);
  assert.equal(isDismissed(m, 'autosave', later(0.5)), true);
  assert.equal(isDismissed(m, 'autosave', later(1)), false);
  assert.equal(DISMISS_RULES.compare.days, 1);
  assert.equal(DISMISS_RULES.install.days, 7);
});

test('中身で決まるカード（在庫の知らせ）：中身が変わるとキーが変わるので、また出る', () => {
  const m = dismiss({}, dismissKey('alert', 'A残り1杯'), NOW);
  assert.equal(isDismissed(m, dismissKey('alert', 'A残り1杯'), NOW), true);
  assert.equal(isDismissed(m, dismissKey('alert', 'A残り0杯'), NOW), false);
});

test('記憶の掃除：期限が過ぎたものと、30日より古い「もう出さない」は忘れる。元の記憶は変えない', () => {
  const m = { 'cool:old': { at: NOW.toISOString(), until: null }, backup: { at: NOW.toISOString(), until: later(7).toISOString() } };
  const p = prune(m, later(FORGET_DAYS + 1));
  assert.deepEqual(p, {});
  assert.equal(Object.keys(m).length, 2);
  assert.deepEqual(Object.keys(prune(m, later(3))).sort(), ['backup', 'cool:old']);
});

test('壊れた記憶（null・文字・日時でない）は閉じていない扱い', () => {
  assert.equal(isDismissed(null, 'backup', NOW), false);
  assert.equal(isDismissed({ backup: 'x' }, 'backup', NOW), false);
  assert.equal(isDismissed({ backup: { at: 'x', until: 'y' } }, 'backup', NOW), false);
  assert.deepEqual(prune({ a: null, b: 3 }, NOW), {});
});
