// 再現性スコア（E7）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reproGroups, reproScore, reproLine, seriesStats, sampleSd, reproWord, REPRO_MIN, REPRO_CHART } from '../js/core/repro.js';
import { analysisRows } from '../js/core/analysis.js';
import { makeDemoData } from '../js/core/demo-data.js';

const beanA = { id: 'bA', name: 'A' };
const beanB = { id: 'bB', name: 'B' };
let n = 0;
/** 分析の行の形（analysisRows）を手で作る */
function row({ bean = beanA, recipeId = 'r1', stars = 4, tds = null, strength = null, context = {}, version = 1 } = {}) {
  n += 1;
  const at = new Date(2026, 9, 1, 7, n).toISOString();
  return {
    at,
    stars,
    bean,
    brew: { id: `w${n}`, at, recipeId, recipeVersion: version, context },
    tasting: strength == null ? null : { jar: { strength } },
    metrics: { tdsPct: tds },
  };
}

test('標準偏差（標本）と言葉の境目', () => {
  assert.equal(sampleSd([4]), null);
  assert.equal(Math.round(sampleSd([2, 4, 4, 4, 5, 5, 7, 9]) * 1000) / 1000, 2.138);
  assert.equal(reproWord(0.49, 'stars').text, '安定');
  assert.equal(reproWord(0.5, 'stars').text, 'ややブレ');
  assert.equal(reproWord(1.0, 'stars').text, 'ブレが大きい');
  assert.equal(reproWord(0.04, 'tds').text, '安定');
  assert.equal(reproWord(0.12, 'tds').text, 'ブレが大きい');
  assert.equal(reproWord(null, 'stars').level, 'none');
});

test('3杯からブレ、8杯から管理図（平均±2σと線の外の番号）', () => {
  assert.equal(REPRO_MIN, 3);
  assert.equal(REPRO_CHART, 8);
  const two = seriesStats([4, 5, null], 'stars');
  assert.equal(two.ready, false);
  assert.equal(two.sd, null);
  const three = seriesStats([4, 5, 3], 'stars');
  assert.equal(three.ready, true);
  assert.equal(three.sd, 1);
  assert.equal(three.chart, null);
  const vals = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1];
  const eight = seriesStats(vals, 'stars');
  assert.ok(eight.chart);
  assert.ok(eight.chart.upper > eight.mean && eight.chart.lower < eight.mean);
  assert.deepEqual(eight.chart.outside, [11]);
});

test('組の分け方：豆の袋×レシピ。アイス・杯数を変えた杯・レシピのない杯・豆のない杯は数えない', () => {
  const rows = [
    row({ stars: 4 }),
    row({ stars: 5 }),
    row({ stars: 4 }),
    row({ stars: 3, context: { iceG: 100 } }),
    row({ stars: 3, context: { cups: 2 } }),
    row({ stars: 3, recipeId: null }),
    { ...row({ stars: 3 }), bean: null },
    row({ bean: beanB, stars: 2 }),
    row({ recipeId: 'r2', stars: 5 }),
  ];
  const g = reproGroups(rows, [{ id: 'r1', name: 'いつもの' }]);
  assert.deepEqual(g.map((x) => [x.key, x.cups]), [['bA|r1', 3], ['bA|r2', 1], ['bB|r1', 1]]);
  assert.equal(g[0].recipeName, 'いつもの');
  assert.equal(g[1].recipeName, '（削除したレシピ）');
  assert.equal(g[0].stars.ready, true);
  assert.equal(g[2].stars.ready, false);
  assert.match(reproLine(g[2]), /^あと2杯で/);
});

test('濃さ：TDSが3杯あればTDS、なければ評価の濃さ（JAR）。★のない杯は★のブレに数えない', () => {
  const tds = reproGroups([row({ tds: 1.3 }), row({ tds: 1.35 }), row({ tds: 1.32, stars: null }), row({ strength: 1 })]);
  assert.equal(tds[0].strength.kind, 'tds');
  assert.equal(tds[0].strength.n, 3);
  assert.equal(tds[0].stars.n, 3);
  assert.match(reproLine(tds[0]), /濃さ（TDS）のブレ ±0\.03%（安定）/);
  const jar = reproGroups([row({ tds: 1.3, strength: 0 }), row({ strength: 1 }), row({ strength: -1 }), row({ stars: 2 })]);
  assert.equal(jar[0].strength.kind, 'jar');
  assert.equal(jar[0].strength.n, 3);
  assert.equal(jar[0].strength.sd, 1);
  assert.match(reproLine(jar[0]), /評価の濃さ）のブレ ±1段階（ブレが大きい）/);
});

test('レシピの版の変わり目に印', () => {
  const g = reproGroups([row({ version: 1 }), row({ version: 1 }), row({ version: 2 }), row({ version: 2 }), row({ version: 3 })]);
  assert.deepEqual(g[0].versionChanges, [2, 4]);
});

test('全体の再現性スコア：3杯以上の組の分散を杯数で合わせ、100−50×ブレ', () => {
  assert.equal(reproScore([]).ready, false);
  const g = reproGroups([
    row({ stars: 4 }), row({ stars: 4 }), row({ stars: 4 }),
    row({ bean: beanB, stars: 3 }), row({ bean: beanB, stars: 5 }), row({ bean: beanB, stars: 4 }),
    row({ recipeId: 'r9', stars: 1 }),
  ]);
  const s = reproScore(g);
  assert.equal(s.groups, 2);
  assert.equal(s.cups, 6);
  // 合わせた分散 = (0×2 + 1×2) ÷ 4 = 0.5 → ブレ 0.71
  assert.equal(s.sd, 0.71);
  assert.equal(s.score, 65);
  assert.equal(s.word.text, 'ややブレ');
});

test('デモデータ：豆ごとに10杯の組が8つ、管理図とスコアが出る', () => {
  const d = makeDemoData();
  const g = reproGroups(analysisRows(d), d.recipes);
  assert.equal(g.length, 8);
  assert.ok(g.every((x) => x.cups === 10 && x.stars.chart));
  const s = reproScore(g);
  assert.ok(s.ready && s.score >= 0 && s.score <= 100);
});
