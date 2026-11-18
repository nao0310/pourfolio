// 水プロファイル（D3）：SCAAの水の基準との差
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWaterInput, waterCheck, waterSummary } from '../js/core/water.js';

test('成分の入力：空は null、全角も読み、範囲外と文字はエラー', () => {
  const { value, errors } = normalizeWaterInput({ tdsMgL: '１５０', hardnessMgL: '', ph: '7.04', alkalinityMgL: 'x', sodiumMgL: '-1' });
  assert.equal(value.tdsMgL, 150);
  assert.equal(value.hardnessMgL, null);
  assert.equal(value.ph, 7);
  assert.ok(errors.alkalinityMgL);
  assert.ok(errors.sodiumMgL);
});

test('基準との比べ：範囲の中・少ない・多い・未入力', () => {
  const c = Object.fromEntries(waterCheck({ tdsMgL: 150, hardnessMgL: 10, alkalinityMgL: 60, ph: 7.5, sodiumMgL: null }).map((x) => [x.key, x]));
  assert.equal(c.tdsMgL.status, 'ok');
  assert.equal(c.tdsMgL.text, '基準の範囲（目標との差 ±0）');
  assert.equal(c.hardnessMgL.status, 'low');
  assert.equal(c.hardnessMgL.text, '基準より少ない（目標との差 −58）');
  assert.equal(c.alkalinityMgL.status, 'high');
  assert.equal(c.ph.status, 'ok'); // 境目は範囲に入れる
  assert.equal(c.sodiumMgL.status, 'none');
  assert.equal(c.tdsMgL.rangeText, '基準 75〜250 mg/L（目標 150）');
});

test('一覧の1行', () => {
  assert.equal(waterSummary({}), '成分は未入力');
  assert.equal(waterSummary({ tdsMgL: 30, ph: 7 }), 'TDS 30・pH 7（基準の外 1項目）');
});
