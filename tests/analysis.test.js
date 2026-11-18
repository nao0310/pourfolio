// 分析（E2〜E5）の計算：答えの分かっている小さな例と、デモデータで全画面の中身が出ること
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisRows, ratedRows, readiness, readinessText, confidenceOf, THRESHOLDS } from '../js/core/analysis.js';
import { changesBetween, cupsToNinety, beanJourneys, averageCupsTo90 } from '../js/core/dialin-history.js';
import { chartPoints, favoriteZone, ratioLineTds, zonePosition, CLASSIC_ZONE } from '../js/core/brew-chart.js';
import { factorAnalysis, factorValue, mainGrinderId, roastCurves } from '../js/core/factors.js';
import { bayesScore, preferenceBy, heatmap, likingPeaks, topLine } from '../js/core/preference.js';
import { makeDemoData, seededRandom } from '../js/core/demo-data.js';

const NOW = new Date('2026-11-18T12:00:00+09:00');
let seq = 0;
const brew = (fields = {}) => ({ id: `b${++seq}`, at: `2026-11-${String(10 + (seq % 9)).padStart(2, '0')}T00:00:00Z`, deletedAt: null, actual: {}, derived: {}, ...fields });
const tasting = (brewId, stars, extra = {}) => ({ id: `t-${brewId}`, brewId, by: 'me', stage: 'warm', stars, deletedAt: null, updatedAt: '1', ...extra });

test('分析の行：古い順に並べ、豆と主な評価と計算値をつなぐ。削除済みは除く', () => {
  const bean = { id: 'x', name: '豆', deletedAt: null };
  const b1 = brew({ at: '2026-11-02T00:00:00Z', beanId: 'x', actual: { doseG: 15, waterG: 240, tdsPct: 1.3 } });
  const b2 = brew({ at: '2026-11-01T00:00:00Z', beanId: 'x', actual: { doseG: 15, waterG: 240 } });
  const b3 = brew({ at: '2026-11-03T00:00:00Z', deletedAt: '2026-11-04' });
  const rows = analysisRows({ brews: [b1, b2, b3], beans: [bean], tastings: [tasting(b1.id, 4)] });
  assert.deepEqual(rows.map((r) => r.brew.id), [b2.id, b1.id]);
  assert.equal(rows[1].bean.name, '豆');
  assert.equal(rows[1].stars, 4);
  assert.equal(rows[0].stars, null);
  assert.equal(rows[1].metrics.eyPct, 18.2); // 1.3 × (240 − 30) ÷ 15
  assert.equal(ratedRows(rows).length, 1);
});

test('目安と信頼度', () => {
  assert.deepEqual(readiness(7, 10), { ready: false, have: 7, need: 10, left: 3 });
  assert.equal(readinessText(readiness(7, 10)), 'あと3杯で表示します（いま7杯）');
  assert.equal(readinessText(readiness(10, 10)), '');
  assert.equal(confidenceOf(4).text, '低');
  assert.equal(confidenceOf(5).text, '中');
  assert.equal(confidenceOf(15).text, '高');
});

test('E2 変えた条件：挽き目・比率・湯温・粉量・レシピ', () => {
  const a = { recipeId: 'r', actual: { doseG: 15, waterG: 225, tempC: 92, grind: { setting: '24' } } };
  const b = { recipeId: 'r', actual: { doseG: 16, waterG: 240, tempC: 94, grind: { setting: '23' } } };
  assert.deepEqual(changesBetween(a, b), ['挽き目 24→23', '湯温 +2℃', '粉量 +1g']); // 比率は 15→15 で変わらない
  assert.deepEqual(changesBetween(a, { ...a, recipeId: 's', actual: { ...a.actual, waterG: 240 } }), ['レシピを変えた', '比率 1:15→1:16']);
  assert.deepEqual(changesBetween(null, b), []);
});

test('E2 自己ベストの9割に届いた杯', () => {
  assert.equal(cupsToNinety([3, 3, 4, 5, 4]), 4); // 5 × 0.9 = 4.5
  assert.equal(cupsToNinety([4, null, 3]), 1);
  assert.equal(cupsToNinety([3, 4, 4]), 2); // 4 × 0.9 = 3.6
  assert.equal(cupsToNinety([null, null]), null);
});

test('E2 豆ごとの道のり：3杯から表示、使った提案の文、最後に淹れた豆が先', () => {
  const beans = [{ id: 'A', name: 'A', deletedAt: null }, { id: 'B', name: 'B', deletedAt: null }];
  const s = { id: 's1', deletedAt: null, action: { short: '挽き目 24 → 23' } };
  const list = [
    brew({ at: '2026-11-01T00:00:00Z', beanId: 'A', actual: { grind: { setting: '24' } } }),
    brew({ at: '2026-11-02T00:00:00Z', beanId: 'A', suggestionId: 's1', actual: { grind: { setting: '23' } } }),
    brew({ at: '2026-11-03T00:00:00Z', beanId: 'A', actual: { grind: { setting: '23' } } }),
    brew({ at: '2026-11-04T00:00:00Z', beanId: 'B' }),
  ];
  const ts = [tasting(list[0].id, 3), tasting(list[1].id, 4, { defects: ['えぐい'] }), tasting(list[2].id, 5)];
  const j = beanJourneys(analysisRows({ brews: list, beans, tastings: ts }), [s]);
  assert.deepEqual(j.map((x) => x.bean.id), ['B', 'A']);
  const a = j[1];
  assert.equal(a.ready.ready, true);
  assert.equal(j[0].ready.left, 2);
  assert.equal(a.best, 5);
  assert.equal(a.cupsTo90, 3);
  assert.deepEqual(a.cups[1].changes, ['挽き目 24→23']);
  assert.equal(a.cups[1].suggestion, '挽き目 24 → 23');
  assert.deepEqual(a.cups[1].defects, ['えぐい']);
  assert.equal(averageCupsTo90(j), null); // 3杯以上の豆が1つだけ
});

test('E3 好きゾーン：★のあるTDS付きが10杯から、★4以上の真ん中50%', () => {
  const pts = (n, stars) => Array.from({ length: n }, (_, i) => ({ x: 18 + i * 0.5, y: 1.2 + i * 0.02, stars }));
  const nine = favoriteZone(pts(9, 4));
  assert.equal(nine.ready, false);
  assert.equal(nine.left, 1);
  assert.equal(nine.zone, null);
  const ten = favoriteZone([...pts(4, 5), ...pts(6, 2)]);
  assert.equal(ten.ready, true);
  assert.equal(ten.goodN, 4);
  assert.deepEqual(ten.zone, { x0: 18.4, x1: 19.1, y0: 1.21, y1: 1.25 }); // x: 18〜19.5 の25%〜75%
  assert.equal(favoriteZone(pts(10, 3)).zone, null, '★4以上が3杯ないと出さない');
});

test('E3 チャートの点・比率の斜線・ゾーンとの位置', () => {
  const b = brew({ actual: { doseG: 15, waterG: 240, tdsPct: 1.4 } });
  const p = chartPoints(analysisRows({ brews: [b, brew({ actual: { doseG: 15, waterG: 240 } })], tastings: [tasting(b.id, 4)] }));
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].x, p[0].y, p[0].stars, p[0].estimated], [19.6, 1.4, 4, true]);
  assert.equal(ratioLineTds(16, 21), 1.5); // 21 ÷ (16 − 2)
  assert.equal(ratioLineTds(1.5, 20), null);
  assert.equal(zonePosition({ x: 20, y: 1.25 }, CLASSIC_ZONE), '好きゾーンの中');
  assert.equal(
    zonePosition({ x: 17, y: 1.1 }, CLASSIC_ZONE),
    '好きゾーンより薄い（粉を増やすか湯を減らす）・抽出が足りない（細かく挽く・湯温を上げる）',
  );
  assert.equal(zonePosition({ x: 20, y: 1.25 }, null), '');
});

test('E4 条件の値：挽き目はいちばん使ったグラインダーだけ', () => {
  const rows = analysisRows({
    brews: [
      brew({ actual: { grind: { grinderId: 'g1', setting: '24' }, tempC: 92, doseG: 15, waterG: 240 }, derived: { daysOffRoast: 9 } }),
      brew({ actual: { grind: { grinderId: 'g1', setting: '22' } } }),
      brew({ actual: { grind: { grinderId: 'g2', setting: '3' } } }),
    ],
  });
  const r0 = rows.find((r) => r.brew.actual.tempC === 92);
  const r2 = rows.find((r) => r.brew.actual.grind.grinderId === 'g2');
  assert.equal(mainGrinderId(rows), 'g1');
  assert.equal(factorValue(r0, 'grind', 'g1'), 24);
  assert.equal(factorValue(r2, 'grind', 'g1'), null);
  assert.equal(factorValue(r0, 'tempC'), 92);
  assert.equal(factorValue(r0, 'ratio'), 16);
  assert.equal(factorValue(r0, 'days'), 9);
});

test('E4 条件と評価：20杯から。挽き目が細かいほど★が高い例で傾向が出る', () => {
  const list = Array.from({ length: 20 }, (_, i) => brew({ actual: { grind: { grinderId: 'g', setting: String(20 + (i % 5)) }, tempC: 92 } }));
  const ts = list.map((b, i) => tasting(b.id, 5 - (i % 5)));
  const fa = factorAnalysis(analysisRows({ brews: list, tastings: ts }));
  assert.equal(fa.ready.ready, true);
  const grind = fa.factors.find((f) => f.key === 'grind');
  assert.equal(Math.round(grind.fit.r * 100) / 100, -1);
  assert.equal(grind.word.level, 'clear');
  assert.equal(fa.factors.find((f) => f.key === 'tempC').fit, null); // 湯温がみな同じ
  assert.equal(fa.strongest.key, 'grind');
  assert.equal(factorAnalysis(analysisRows({ brews: list.slice(0, 19), tastings: ts })).ready.left, 1);
});

test('E4 飲み頃カーブ：同じ焙煎度で5袋から、2杯以上の区切りで山を出す', () => {
  const beans = Array.from({ length: 5 }, (_, i) => ({ id: `bean${i}`, roastLevel: 'シティ', deletedAt: null }));
  const list = [];
  const ts = [];
  beans.forEach((bn, i) => {
    for (const [days, stars] of [[2, 2], [9, 5], [20, 3]]) {
      const b = brew({ beanId: bn.id, derived: { daysOffRoast: days + (i % 2) } });
      list.push(b);
      ts.push(tasting(b.id, stars));
    }
  });
  const [c] = roastCurves(analysisRows({ brews: list, beans, tastings: ts }));
  assert.equal(c.level, 'シティ');
  assert.equal(c.bags, 5);
  assert.equal(c.ready.ready, true);
  assert.equal(c.peak.label, '8〜11日');
  assert.equal(c.bins.find((b) => b.label === '0〜3日').mean, 2);
  const [four] = roastCurves(analysisRows({ brews: list.slice(0, 12), beans, tastings: ts }));
  assert.equal(four.ready.left, 1);
});

test('E5 嗜好スコア（ベイズ平均）：1杯だけの★5は1位にならない', () => {
  assert.equal(bayesScore(5, 4, 3), 3.5); // (5×4 + 5×3) ÷ 10
  assert.equal(bayesScore(0, null, 3.2), 3.2);
  const beans = [
    { id: 'k', origin: { country: 'ケニア' }, process: 'ウォッシュト', roastLevel: 'ハイ', deletedAt: null },
    { id: 'e', origin: { country: 'エチオピア' }, process: 'ナチュラル', roastLevel: 'シティ', deletedAt: null },
    { id: 'p', origin: { country: 'パナマ' }, process: 'ウォッシュト', roastLevel: 'シティ', deletedAt: null },
  ];
  const list = [];
  const ts = [];
  const add = (beanId, stars) => {
    const b = brew({ beanId });
    list.push(b);
    ts.push(tasting(b.id, stars));
  };
  for (let i = 0; i < 10; i++) add('k', i % 2 ? 5 : 4); // 平均4.5
  for (let i = 0; i < 10; i++) add('e', 3);
  add('p', 5);
  const rows = analysisRows({ brews: list, beans, tastings: ts });
  const by = preferenceBy(rows, 'origin');
  assert.equal(by[0].key, 'ケニア');
  assert.equal(by[0].mean, 4.5);
  const panama = by.find((x) => x.key === 'パナマ');
  assert.equal(panama.n, 1);
  assert.ok(panama.score < by[0].score);
  assert.equal(panama.confidence.text, '低');
  assert.ok(topLine(by, '産地').startsWith('好きな産地はケニア'));
  const hm = heatmap(rows, 'origin');
  assert.deepEqual(hm.cols, ['ハイ', 'シティ']);
  assert.deepEqual(hm.rows, ['エチオピア', 'ケニア', 'パナマ']); // 件数の多い順（同じなら名前の順）
  assert.equal(hm.cells['ケニア']['シティ'], null);
  assert.equal(hm.cells['パナマ']['シティ'].n, 1);
  assert.deepEqual(preferenceBy([], 'origin'), []);
});

test('E5 味の好みの位置：詳細評価20件から、項目ごとに好みが高い強さ', () => {
  const ts = Array.from({ length: 20 }, (_, i) => {
    const it = (i % 5) * 3; // 0,3,6,9,12
    return { id: `d${i}`, deletedAt: null, intensity: { acidity: it }, liking: { acidity: it === 9 ? 8 : 4 } };
  });
  const lp = likingPeaks(ts);
  assert.equal(lp.ready.ready, true);
  const acid = lp.attrs.find((a) => a.key === 'acidity');
  assert.equal(acid.n, 20);
  assert.equal(acid.peak.label, '7〜9');
  assert.equal(lp.attrs.find((a) => a.key === 'sweetness').peak, null);
  assert.equal(likingPeaks(ts.slice(0, 19)).ready.left, 1);
});

test('デモデータ：同じ日なら同じ中身。全画面の計算が中身を返す', () => {
  const a = makeDemoData(NOW);
  const b = makeDemoData(NOW);
  const shape = (d) => d.brews.map((x) => [x.at, x.actual.waterG, x.actual.tempC, x.actual.totalSec, x.actual.tdsPct, x.actual.grind.setting]);
  assert.deepEqual(shape(a), shape(b));
  assert.equal(seededRandom(1)(), seededRandom(1)());
  assert.equal(a.beans.length, 8);
  assert.equal(a.brews.length, 80);
  assert.equal(a.settings.length, 0, '設定は入れない');
  const rows = analysisRows(a);
  assert.equal(ratedRows(rows).length, 80);
  // つながりが壊れていない
  const ids = new Set(a.brews.map((x) => x.id));
  assert.ok(a.tastings.every((t) => ids.has(t.brewId)));
  assert.ok(a.suggestions.every((s) => ids.has(s.brewId) && ids.has(s.nextBrewId)));
  assert.ok(a.brews.filter((x) => x.suggestionId).every((x) => a.suggestions.some((s) => s.id === x.suggestionId)));
  // 各画面
  const j = beanJourneys(rows, a.suggestions);
  assert.ok(j.every((x) => x.ready.ready));
  assert.ok(j.some((x) => x.cups.some((c) => c.suggestion)));
  const pts = chartPoints(rows);
  assert.ok(pts.length >= THRESHOLDS.zone);
  assert.ok(favoriteZone(pts).zone);
  assert.equal(factorAnalysis(rows).ready.ready, true);
  assert.ok(roastCurves(rows).some((c) => c.ready.ready));
  assert.ok(preferenceBy(rows, 'origin').length >= 5);
  assert.equal(likingPeaks(a.tastings).ready.ready, true);
  // 今日から91日以内
  const oldest = Math.min(...a.brews.map((x) => Date.parse(x.at)));
  assert.ok(NOW.getTime() - oldest <= 91 * 86400000);
});
