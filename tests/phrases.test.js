// 言葉の切れ目で折る（3-1.1）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPhrases } from '../js/core/phrases.js';

const words = (s) => splitPhrases(s).filter((t) => t.trim());

test('つなげると元の文に戻る', () => {
  for (const s of ['', '挽き目 24 → 22（2目盛り細かく）', 'A：シティ　デモ ケニア と B', '★を付けた12杯から、いちばん良くなりそうな所（予想 ★3.8 ±0.9）']) {
    assert.equal(splitPhrases(s).join(''), s);
  }
  assert.deepEqual(splitPhrases(null), []);
});

test('矢印の両側と、短い見出しと数字は離さない', () => {
  assert.deepEqual(words('挽き目 24 → 22（2目盛り細かく）'), ['挽き目 24 → 22', '（2目盛り細かく）']);
  assert.deepEqual(words('比率 1:16 → 1:17'), ['比率 1:16 → 1:17']);
  assert.deepEqual(words('挽き目 20・比率 1:17.5'), ['挽き目 20・', '比率 1:17.5']);
});

test('空白・読点・中黒・かっこで区切る', () => {
  assert.deepEqual(words('デモ ケニア キリニャガ 挽き目の飲み比べ'), ['デモ', 'ケニア', 'キリニャガ', '挽き目の飲み比べ']);
  assert.deepEqual(words('12杯の★から、いちばん良くなりそうな所（予想 ★3.8 ±0.9）'), ['12杯の★から、', 'いちばん良くなりそうな所', '（予想 ★3.8 ±0.9）']);
  // 長い言葉のあとの数字はつながない
  assert.deepEqual(words('いちばん良かった杯 4'), ['いちばん良かった杯', '4']);
});
