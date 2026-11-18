// 生活との関係（E6）と季節の好みの変化（X20）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lifeBy, lifeLine, roastByBand, seasonOf, dayOf, seasonSummary, seasonLine, seasonReview, lifeReadiness, weatherCount, MIN_GROUP, LIFE_NEED } from '../js/core/life.js';

const bean = (roastLevel) => ({ id: roastLevel, roastLevel });
/** 分析の行の形（analysisRows）を手で作る */
function row(at, stars, { context = {}, roast = 'シティ' } = {}) {
  return { at, stars, brew: { at, context }, bean: bean(roast), tasting: null, metrics: {}, ymd: at.slice(0, 10) };
}

test('季節（春3〜5月・夏6〜8月・秋9〜11月・冬12〜2月）と、朝5時区切りの曜日', () => {
  assert.equal(seasonOf(new Date(2026, 2, 1)).key, 'spring');
  assert.equal(seasonOf(new Date(2026, 7, 31)).key, 'summer');
  assert.equal(seasonOf(new Date(2026, 10, 18)).key, 'autumn');
  assert.equal(seasonOf(new Date(2026, 11, 1)).key, 'winter');
  assert.equal(seasonOf(new Date(2027, 1, 28)).key, 'winter');
  assert.equal(dayOf(new Date(2026, 10, 21, 10)), 6, '土曜の朝');
  assert.equal(dayOf(new Date(2026, 10, 23, 2)), 0, '月曜の2時は日曜の夜');
});

test('区分ごとの★：3杯未満は棒にせず数だけ、表示の順は区分の順', () => {
  const rows = [
    ...[5, 4, 5].map((s, i) => row(new Date(2026, 10, 16 + i, 7).toISOString(), s)), // 朝（平日）
    ...[3, 3, 2, 3].map((s, i) => row(new Date(2026, 10, 16 + i, 20).toISOString(), s)), // 夜
    row(new Date(2026, 10, 16, 13).toISOString(), 4), // 昼1杯
    row(new Date(2026, 10, 16, 14).toISOString(), null), // ★なし
  ];
  const r = lifeBy(rows, 'band');
  assert.deepEqual(r.shown.map((g) => [g.key, g.n, g.mean]), [['morning', 3, 4.67], ['night', 4, 2.75]]);
  assert.deepEqual(r.few, [{ label: '昼（11〜17時）', n: 1 }]);
  assert.equal(r.counted, 8);
  assert.ok(r.shown[0].score < r.shown[0].mean, '全体の平均に寄せる');
  assert.match(lifeLine(r), /^朝（5〜11時）がいちばん高め/);
  assert.equal(MIN_GROUP, 3);
  assert.throws(() => lifeBy(rows, 'x'));
});

test('気分・ホットとアイス・天気の分け方（天気のない杯は数えない）', () => {
  const w = (tempC, humidity, code) => ({ weather: { tempC, humidity, code } });
  const rows = [
    row('2026-07-01T08:00:00+09:00', 4, { context: { mood: 'wake', iceG: 80, ...w(31, 75, 0) } }),
    row('2026-07-02T08:00:00+09:00', 5, { context: { mood: 'wake', iceG: 80, ...w(30, 80, 1) } }),
    row('2026-07-03T08:00:00+09:00', 4, { context: { mood: 'wake', iceG: 80, ...w(29, 72, 2) } }),
    row('2026-07-04T08:00:00+09:00', 3, { context: { mood: 'nope' } }),
  ];
  assert.deepEqual(lifeBy(rows, 'mood').shown.map((g) => g.key), ['wake']);
  assert.deepEqual(lifeBy(rows, 'mood').few, [{ label: '選ばなかった', n: 1 }]);
  assert.deepEqual(lifeBy(rows, 'iced').shown.map((g) => g.key), ['iced']);
  const t = lifeBy(rows, 'temp');
  assert.equal(t.counted, 3);
  assert.deepEqual(t.shown.map((g) => g.label), ['28℃以上']);
  assert.equal(lifeBy(rows, 'humidity').shown[0].label, '70%以上');
  assert.equal(lifeBy(rows, 'weather').counted, 3);
  assert.equal(weatherCount(rows), 3);
  assert.equal(lifeLine(lifeBy(rows, 'temp')), '', '比べる区分が1つだけ');
});

test('差がほとんどないときは、そう書く', () => {
  const rows = [6, 7, 8, 20, 21, 22].map((h) => row(new Date(2026, 10, 18, h).toISOString(), 4));
  assert.equal(lifeLine(lifeBy(rows, 'band')), '時間帯による★の差は、ほとんどありません');
});

test('時間帯ごとによく選んだ焙煎度（★がなくても数える）', () => {
  const rows = [
    row(new Date(2026, 10, 18, 7).toISOString(), null, { roast: 'ミディアム' }),
    row(new Date(2026, 10, 19, 7).toISOString(), 4, { roast: 'ハイ' }),
    row(new Date(2026, 10, 19, 8).toISOString(), 4, { roast: 'フレンチ' }),
    row(new Date(2026, 10, 19, 21).toISOString(), 4, { roast: '不明' }),
  ];
  const r = roastByBand(rows);
  assert.deepEqual(r.map((b) => [b.key, b.n, b.group, b.share]), [['morning', 3, 'medium', 67], ['day', 0, null, 0], ['night', 1, null, 0]]);
});

test('季節ごとのまとめ：★のいちばん高い焙煎度と、ホットとアイス', () => {
  const rows = [
    ...[5, 5].map((s, i) => row(`2026-07-0${i + 1}T08:00:00+09:00`, s, { roast: 'ハイ', context: { iceG: 60 } })),
    ...[4, 4].map((s, i) => row(`2026-07-1${i + 1}T08:00:00+09:00`, s, { roast: 'シティ', context: { iceG: 60 } })),
    ...[3, 3].map((s, i) => row(`2026-08-0${i + 1}T08:00:00+09:00`, s, { roast: 'フレンチ' })),
    row('2026-11-01T08:00:00+09:00', 4),
  ];
  const s = seasonSummary(rows);
  const summer = s.find((x) => x.key === 'summer');
  assert.equal(summer.n, 6);
  assert.equal(summer.best.label, '中煎り');
  assert.deepEqual(summer.hotIced, { hot: { n: 2, mean: 3 }, iced: { n: 4, mean: 4.5 } });
  assert.equal(seasonLine(summer), '中煎りが★5.0でいちばん（2杯）。アイスが★4.5、ホットが★3.0');
  const autumn = s.find((x) => x.key === 'autumn');
  assert.equal(autumn.ready, false);
  assert.equal(seasonLine(autumn), '★のある杯が5杯たまると出します（いま1杯）');
});

test('季節の変わり目の見直し：3・6・9・12月の15日まで、去年の同じ季節が5杯以上のとき', () => {
  const lastSummer = [
    ...[5, 5, 5].map((s, i) => row(new Date(2025, 5, 10 + i, 8).toISOString(), s, { roast: 'ハイ', context: { iceG: 60 } })),
    ...[3, 3].map((s, i) => row(new Date(2025, 7, 10 + i, 8).toISOString(), s, { roast: 'フレンチ' })),
    row(new Date(2025, 8, 1, 8).toISOString(), 1), // 去年の秋（数えない）
  ];
  const r = seasonReview({ rows: lastSummer, now: new Date(2026, 5, 3, 9) });
  assert.equal(r.key, '2026-summer');
  assert.equal(r.n, 5);
  assert.equal(r.text, '去年の夏は5杯淹れました。中煎りの★が高めでした（★5.0・3杯）。アイスの★がホットより高めでした。');
  assert.equal(seasonReview({ rows: lastSummer, now: new Date(2026, 5, 16, 9) }), null, '16日から出さない');
  assert.equal(seasonReview({ rows: lastSummer, now: new Date(2026, 6, 3, 9) }), null, '7月は変わり目でない');
  assert.equal(seasonReview({ rows: lastSummer.slice(0, 4), now: new Date(2026, 5, 3, 9) }), null, '4杯では出さない');
  // 冬は12〜2月（年をまたぐ）
  const lastWinter = [0, 1, 2, 3, 4].map((i) => row(new Date(2026, 0, 5 + i, 8).toISOString(), 4));
  assert.equal(seasonReview({ rows: lastWinter, now: new Date(2026, 11, 1, 9) }).n, 5);
});

test('画面を出す目安は★のある杯が30杯', () => {
  assert.equal(LIFE_NEED, 30);
  const rows = Array.from({ length: 29 }, (_, i) => row(new Date(2026, 9, 1 + i, 8).toISOString(), 4));
  assert.deepEqual(lifeReadiness(rows), { ready: false, have: 29, need: 30, left: 1 });
  rows.push(row('2026-11-01T08:00:00+09:00', 3));
  assert.equal(lifeReadiness(rows).ready, true);
});
