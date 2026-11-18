// TDS・抽出収率・抽出液の見積もり・カフェイン（A8、spec 5.1）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTds,
  extractionYieldPct,
  measuredRetention,
  retentionTable,
  retentionFor,
  beverageOf,
  caffeineMg,
  brewMetrics,
  metricsText,
  DEFAULT_RETENTION,
} from '../js/core/extraction.js';

const brew = (actual, dripperId = 'd1', extra = {}) => ({ id: Math.random().toString(36), actual, equipment: { dripperId }, ...extra });

test('TDSの入力：全角・%付きも読み、範囲外と文字はエラー、空は null', () => {
  assert.deepEqual(normalizeTds('1.35'), { value: 1.35, error: null });
  assert.deepEqual(normalizeTds('１．４％'), { value: 1.4, error: null });
  assert.deepEqual(normalizeTds(1.234), { value: 1.23, error: null });
  assert.deepEqual(normalizeTds(''), { value: null, error: null });
  assert.deepEqual(normalizeTds(null), { value: null, error: null });
  assert.ok(normalizeTds('0').error);
  assert.ok(normalizeTds('8').error);
  assert.ok(normalizeTds('abc').error);
});

test('抽出収率 = TDS × 抽出液 ÷ 粉量（答えの分かっている例）', () => {
  // 1.35% × 260g ÷ 20g = 17.55% → 17.6
  assert.equal(extractionYieldPct(1.35, 260, 20), 17.6);
  // 1.25% × 240g ÷ 15g = 20%
  assert.equal(extractionYieldPct(1.25, 240, 15), 20);
  assert.equal(extractionYieldPct(null, 240, 15), null);
  assert.equal(extractionYieldPct(1.25, null, 15), null);
  assert.equal(extractionYieldPct(1.25, 240, 0), null);
});

test('量った杯の保持率。量り間違いらしい値と抽出液>湯量は使わない', () => {
  assert.equal(measuredRetention(brew({ doseG: 20, waterG: 300, beverageG: 260 })), 2);
  assert.equal(measuredRetention(brew({ doseG: 20, waterG: 300 })), null);
  assert.equal(measuredRetention(brew({ doseG: 20, waterG: 300, beverageG: 299 })), null); // 0.05
  assert.equal(measuredRetention(brew({ doseG: 20, waterG: 300, beverageG: 310 })), null);
});

test('ドリッパーごとの保持率は中央値。2杯以上で使い、それまでは初期値2.0', () => {
  const brews = [
    brew({ doseG: 20, waterG: 300, beverageG: 250 }), // 2.5
    brew({ doseG: 20, waterG: 300, beverageG: 256 }), // 2.2
    brew({ doseG: 20, waterG: 300, beverageG: 240 }), // 3.0
    brew({ doseG: 15, waterG: 240, beverageG: 210 }, 'd2'), // 2.0
    brew({ doseG: 20, waterG: 300, beverageG: 200 }, 'd1', { deletedAt: '2026-01-01' }), // 削除済み
  ];
  const table = retentionTable(brews);
  assert.deepEqual(table.d1, { retention: 2.5, n: 3 });
  assert.deepEqual(table.d2, { retention: 2, n: 1 });
  assert.deepEqual(retentionFor({ equipment: { dripperId: 'd1' } }, table), { retention: 2.5, learned: true, n: 3 });
  assert.deepEqual(retentionFor({ equipment: { dripperId: 'd2' } }, table), { retention: DEFAULT_RETENTION, learned: false, n: 1 });
  assert.deepEqual(retentionFor({}, table), { retention: DEFAULT_RETENTION, learned: false, n: 0 });
});

test('抽出液：量っていればその値、なければ 湯量 − 保持率 × 粉量', () => {
  assert.deepEqual(beverageOf(brew({ doseG: 20, waterG: 300, beverageG: 262 })), { g: 262, estimated: false });
  assert.deepEqual(beverageOf(brew({ doseG: 20, waterG: 300 })), { g: 260, estimated: true });
  const table = { d1: { retention: 2.5, n: 3 } };
  assert.deepEqual(beverageOf(brew({ doseG: 20, waterG: 300 }), table), { g: 250, estimated: true });
  assert.deepEqual(beverageOf(brew({ doseG: 20 })), { g: null, estimated: true });
});

test('カフェイン：比率1:15・150gで90mg、比率が濃いと増える', () => {
  assert.equal(caffeineMg(150, 15), 90);
  assert.equal(caffeineMg(100, 10), 90); // 100 × 0.6 × 15 ÷ 10
  assert.equal(caffeineMg(260, 15), 156); // spec 9章の例
  assert.equal(caffeineMg(null, 15), null);
  assert.equal(caffeineMg(150, null), null);
});

test('1杯の計算値のまとめと短い文', () => {
  const m = brewMetrics(brew({ doseG: 20, waterG: 300, tdsPct: 1.35 }));
  assert.deepEqual(m, { ratio: 15, beverageG: 260, beverageEstimated: true, tdsPct: 1.35, eyPct: 17.6, caffeineMg: 156 });
  assert.equal(metricsText(m), 'TDS 1.35%・収率 17.6%（抽出液は見積もり）');
  const m2 = brewMetrics(brew({ doseG: 15, waterG: 240, beverageG: 210, tdsPct: 1.3 }));
  assert.equal(m2.eyPct, 18.2);
  assert.equal(metricsText(m2), 'TDS 1.3%・収率 18.2%');
  assert.equal(metricsText(brewMetrics(brew({ doseG: 20, waterG: 300 }))), '');
});
