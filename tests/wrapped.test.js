// 年間まとめ「Coffee Wrapped」（X5）と産地地図
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrappedSlides,
  wrappedYears,
  isYear,
  longestStreak,
  periodText,
  cupStats,
  originMap,
  bestOf,
  tasteTop,
  growthOf,
  growthLine,
  suggestionEffect,
  effectLine,
  moneyOf,
  wrappedNotice,
  wrappedImageContent,
  FAVORITE_MIN,
  NOTICE_MIN_CUPS,
} from '../js/core/wrapped.js';
import { originPoint, project, ORIGIN_POINTS, LAND, MAP_W, MAP_H, BELT_LAT, landPath } from '../js/core/origin-map.js';
import { analysisRows } from '../js/core/analysis.js';
import { makeDemoData } from '../js/core/demo-data.js';

const local = (y, m, d, h = 8) => new Date(y, m - 1, d, h).toISOString();
const beanA = { id: 'bA', name: 'ケニア ニエリ', roastLevel: 'ハイ', process: 'ウォッシュト', origin: { country: 'ケニア' }, priceJpy: 1000, actualWeightG: 200 };
const beanB = { id: 'bB', name: 'ブラジル', roastLevel: 'フルシティ', process: 'ナチュラル', origin: { country: 'ブラジル' } };

let n = 0;
function cup(at, bean, stars, extra = {}) {
  n += 1;
  const brew = { id: `c${n}`, at, beanId: bean?.id ?? null, actual: { doseG: 15, waterG: 240 }, ...extra };
  const tasting = stars == null ? null : { id: `t${n}`, brewId: brew.id, stars };
  return { brew, tasting };
}
function dataOf(cups, more = {}) {
  return { brews: cups.map((c) => c.brew), tastings: cups.map((c) => c.tasting).filter(Boolean), beans: [beanA, beanB], suggestions: [], recipes: [], orders: [], ...more };
}

test('年：暦年で、記録のある年と今年を新しい順に。削除した杯の年は出さない', () => {
  assert.ok(isYear('2026'));
  assert.ok(!isYear('26'));
  assert.ok(!isYear('2026-11'));
  const brews = [{ id: '1', at: local(2024, 5, 1) }, { id: '2', at: local(2025, 12, 31, 23) }, { id: '3', at: local(2023, 1, 1), deletedAt: 'x' }];
  assert.deepEqual(wrappedYears(brews, '2026-11-18'), ['2026', '2025', '2024']);
});

test('年の境目は端末の時刻の日付（12月31日の夜は前の年、1月1日の朝は新しい年）', () => {
  const cups = [cup(local(2025, 12, 31, 23), beanA, 4), cup(local(2026, 1, 1, 0), beanA, 3), cup(local(2026, 1, 1, 7), beanA, 5)];
  assert.equal(wrappedSlides(dataOf(cups), '2025', '2026-11-18').cups, 1);
  assert.equal(wrappedSlides(dataOf(cups), '2026', '2026-11-18').cups, 2);
});

test('期間の言葉：今年は今日まで、過去の年は12月31日まで', () => {
  assert.equal(periodText('2026', '2026-11-18'), '1月1日〜11月18日（今日まで）');
  assert.equal(periodText('2025', '2026-11-18'), '1月1日〜12月31日');
  assert.equal(periodText('2026', '2026-12-31'), '1月1日〜12月31日');
});

test('続けて淹れた最長の日数（同じ日の2杯は1日、月をまたいでも続く）', () => {
  assert.equal(longestStreak([]), 0);
  assert.equal(longestStreak(['2026-03-01']), 1);
  assert.equal(longestStreak(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-01', '2026-02-03', '2026-02-04']), 3);
  assert.equal(longestStreak(['2026-02-28', '2026-03-01']), 2, '2026年は閏年ではない');
});

test('杯数のカード：杯・日・豆の数、月ごとの数、いちばん多い月', () => {
  const rows = analysisRows(dataOf([cup(local(2026, 3, 1), beanA, 4), cup(local(2026, 3, 1, 15), beanB, 3), cup(local(2026, 7, 2), beanA, null)]));
  const s = cupStats(rows);
  assert.equal(s.cups, 3);
  assert.equal(s.days, 2);
  assert.equal(s.beans, 2);
  assert.equal(s.byMonth.length, 12);
  assert.equal(s.byMonth[2].cups, 2);
  assert.deepEqual(s.topMonth, { month: 3, cups: 2 });
});

test('産地：杯の多い順。表にない産地は一覧だけ、産地のない杯は数を別に持つ', () => {
  const odd = { id: 'bO', name: '謎の豆', origin: { country: 'アトランティス' } };
  const none = { id: 'bN', name: '産地なし' };
  const cups = [cup(local(2026, 1, 1), beanA, 4), cup(local(2026, 1, 2), beanA, 4), cup(local(2026, 1, 3), beanB, 3), cup(local(2026, 1, 4), odd, 3), cup(local(2026, 1, 5), none, 3)];
  const m = originMap(analysisRows({ ...dataOf(cups), beans: [beanA, beanB, odd, none] }));
  assert.equal(m.countries, 3);
  assert.equal(m.unknownCups, 1);
  assert.equal(m.list[0].key, 'ケニア');
  assert.equal(m.list[0].cups, 2);
  assert.ok(m.list[0].pos);
  assert.equal(m.list.find((o) => o.key === 'アトランティス').pos, null);
});

test('産地の位置：全角・空白・中黒を無視し、言葉の中の国や地域を長い名前から当てる', () => {
  assert.deepEqual(originPoint('ケニア'), ORIGIN_POINTS.ケニア);
  assert.deepEqual(originPoint(' パプア・ニューギニア '), ORIGIN_POINTS.パプアニューギニア);
  assert.deepEqual(originPoint('インドネシア（スマトラ）'), ORIGIN_POINTS.インドネシア);
  assert.deepEqual(originPoint('インド'), ORIGIN_POINTS.インド);
  assert.deepEqual(originPoint('ドミニカ共和国'), ORIGIN_POINTS.ドミニカ);
  assert.deepEqual(originPoint('中国 雲南省'), ORIGIN_POINTS.雲南);
  assert.equal(originPoint(''), null);
  assert.equal(originPoint(null), null);
});

test('地図：産地の点はすべて地図の中、コーヒーベルトは帯の中。輪郭は形になっている', () => {
  for (const [name, p] of Object.entries(ORIGIN_POINTS)) {
    const { x, y } = project(p);
    assert.ok(x >= 0 && x <= MAP_W && y >= 0 && y <= MAP_H, `${name} が地図の外（${x}, ${y}）`);
  }
  assert.ok(project([0, BELT_LAT]).y > 0 && project([0, -BELT_LAT]).y < MAP_H);
  assert.ok(LAND.every((poly) => poly.length >= 3 && poly.every(([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90)));
  assert.equal((landPath().match(/Z/g) ?? []).length, LAND.length);
  assert.doesNotMatch(landPath(), /NaN|undefined/);
});

test('ベスト：★の高い3杯（同じ★は新しい方）と、3杯以上の銘柄でいちばん平均★の高い豆（同じ銘柄の袋はまとめる）', () => {
  const beanA2 = { ...beanA, id: 'bA2', name: 'ケニア　ニエリ' }; // 全角の空白
  const cups = [cup(local(2026, 1, 1), beanA, 4), cup(local(2026, 1, 2), beanA2, 5), cup(local(2026, 1, 3), beanA2, 4), cup(local(2026, 1, 4), beanB, 5), cup(local(2026, 1, 5), beanB, 5)];
  const b = bestOf(analysisRows({ ...dataOf(cups), beans: [beanA, beanA2, beanB] }));
  assert.deepEqual(b.top.map((t) => t.stars), [5, 5, 5]);
  assert.equal(b.top[0].brewId, cups[4].brew.id, '同じ★なら新しい杯が先');
  assert.equal(FAVORITE_MIN, 3);
  assert.equal(b.favorite.name, 'ケニア ニエリ', 'ブラジルは2杯なので選ばない');
  assert.equal(b.favorite.n, 3);
  assert.equal(b.favorite.avg, 4.3);
});

test('好み：3杯以上の区分だけで、嗜好スコアのいちばん高いもの', () => {
  const cups = [cup(local(2026, 1, 1), beanA, 5), cup(local(2026, 1, 2), beanA, 5), cup(local(2026, 1, 3), beanA, 4), cup(local(2026, 1, 4), beanB, 2), cup(local(2026, 1, 5), beanB, 2)];
  const t = tasteTop(analysisRows(dataOf(cups)));
  assert.deepEqual(t.map((x) => `${x.label}:${x.value}`), ['焙煎度:ハイ', '精製:ウォッシュト', '産地:ケニア']);
  assert.deepEqual(tasteTop(analysisRows(dataOf(cups.slice(3)))), [], '2杯しかない区分は出さない');
});

test('成長：月ごとの平均★、10杯からの前半と後半の比べ', () => {
  const cups = [];
  for (let i = 0; i < 5; i += 1) cups.push(cup(local(2026, 2, 1 + i), beanA, 3));
  for (let i = 0; i < 5; i += 1) cups.push(cup(local(2026, 6, 1 + i), beanA, 4));
  const g = growthOf(analysisRows(dataOf(cups)));
  assert.deepEqual(g.months, [{ month: 2, n: 5, avg: 3 }, { month: 6, n: 5, avg: 4 }]);
  assert.deepEqual(g.halves, { firstAvg: 3, secondAvg: 4, firstN: 5, secondN: 5 });
  assert.equal(growthLine(g), '年の後半は平均★が3から4に上がりました');
  assert.equal(growthOf(analysisRows(dataOf(cups.slice(0, 9)))).halves, null, '9杯では比べない');
  assert.equal(growthLine({ halves: null }), '');
  assert.match(growthLine({ halves: { firstAvg: 4, secondAvg: 3.5 } }), /下がりました/);
  assert.match(growthLine({ halves: { firstAvg: 4, secondAvg: 4 } }), /前半も後半も4/);
});

test('提案の効果（完了条件3）：採用した提案だけ、前とあとの両方に★がある回を、あとの杯の年で数える', () => {
  const c1 = cup(local(2026, 4, 1), beanA, 3);
  const c2 = cup(local(2026, 4, 2), beanA, 4);
  const c3 = cup(local(2026, 4, 3), beanA, 4);
  const c4 = cup(local(2026, 4, 4), beanA, null); // あとの杯に★がない
  const c5 = cup(local(2025, 12, 31), beanA, 2);
  const c6 = cup(local(2026, 1, 1), beanA, 3); // 前の杯が去年でも、あとの杯が今年なら今年
  const gone = cup(local(2026, 4, 5), beanA, 5);
  gone.brew.deletedAt = '2026-04-06T00:00:00Z';
  const sug = (id, from, to, adopted = true, more = {}) => ({ id, brewId: from.brew.id, nextBrewId: to?.brew.id ?? null, adopted, action: { short: '細かく' }, ...more });
  const suggestions = [
    sug('s1', c1, c2),
    sug('s2', c2, c3),
    sug('s3', c3, c4),
    sug('s4', c5, c6),
    sug('s5', c1, c3, false), // 採用しなかった
    sug('s6', c1, null), // まだ淹れていない
    sug('s7', c3, gone), // あとの杯を消した
    sug('s8', c1, c2, true, { deletedAt: 'x' }),
  ];
  const data = dataOf([c1, c2, c3, c4, c5, c6, gone], { suggestions });
  const e = suggestionEffect({ ...data, year: '2026' });
  assert.equal(e.n, 3);
  assert.deepEqual(e.pairs.map((p) => p.suggestionId), ['s1', 's2', 's4']);
  assert.equal(e.beforeAvg, 3); // (3 + 4 + 2) / 3
  assert.equal(e.afterAvg, 3.7); // (4 + 4 + 3) / 3
  assert.deepEqual([e.up, e.same, e.down], [2, 1, 0]);
  assert.equal(effectLine(e), '提案どおりに淹れた3回で、★は平均3から3.7に上がりました');
  assert.equal(suggestionEffect({ ...data, year: '2025' }).n, 0);
  assert.equal(effectLine({ n: 0 }), '');
  assert.match(effectLine({ n: 2, beforeAvg: 4, afterAvg: 3.5 }), /下がりました/);
  assert.match(effectLine({ n: 2, beforeAvg: 4, afterAvg: 4 }), /平均4のままでした/);
});

test('お金：その年の12か月の合計と1杯の原価、使った豆の重さ', () => {
  const cups = [cup(local(2026, 1, 10), beanA, 4), cup(local(2026, 12, 20), beanA, 4), cup(local(2025, 12, 20), beanA, 4)];
  const data = dataOf(cups, { beans: [{ ...beanA, orderDate: '2026-01-05' }, beanB] });
  const rows = analysisRows(data).filter((r) => r.ymd.startsWith('2026'));
  const m = moneyOf({ ...data, rows, year: '2026' });
  assert.equal(m.gramsUsed, 30);
  assert.ok(m.drankJpy > 0);
  assert.equal(m.drankJpy, 150, '200gで1000円の豆を15gずつ2杯（去年の杯は数えない）');
  assert.equal(m.perCupJpy, 75);
  assert.equal(m.boughtJpy, 1000);
  assert.equal(m.bags, 1);
});

test('カード：記録のない年は表紙だけ。データの足りないカードは出さない', () => {
  const empty = wrappedSlides(dataOf([]), '2026', '2026-11-18');
  assert.deepEqual(empty.slides.map((s) => s.key), ['cover']);
  assert.equal(empty.cups, 0);
  const one = wrappedSlides(dataOf([cup(local(2026, 3, 1), { id: 'x', name: '産地なし' }, null)]), '2026', '2026-11-18');
  assert.deepEqual(one.slides.map((s) => s.key), ['cover', 'cups', 'money', 'summary'], '★も産地もない1杯');
});

test('カード：デモのデータでは全部のカードが出て、中身に NaN や undefined がない', () => {
  const r = wrappedSlides(makeDemoData(), '2026', '2026-11-18');
  assert.deepEqual(r.slides.map((s) => s.key), ['cover', 'cups', 'origins', 'best', 'taste', 'growth', 'effect', 'life', 'aging', 'money', 'summary']);
  assert.doesNotMatch(JSON.stringify(r), /NaN|undefined|null杯/);
  const effect = r.slides.find((s) => s.key === 'effect');
  assert.ok(effect.n > 0);
  const img = wrappedImageContent(r.slides.at(-1), r.period);
  assert.equal(img.title, '2026年のコーヒー');
  assert.equal(img.stats.length, 6);
  assert.doesNotMatch(JSON.stringify(img), /NaN|undefined/);
});

test('画像の中身：長い豆の名前は切り、ない項目は出さない', () => {
  const img = wrappedImageContent({ year: '2026', cups: 1, days: 1, beans: 1, countries: 0, avgStars: null, favorite: { name: 'あ'.repeat(40), avg: 4, n: 3 }, topOrigin: '', effect: null, gramsUsed: 15 });
  assert.equal(img.stats[4].value, '—');
  assert.equal(img.lines.length, 1);
  assert.equal([...img.lines[0].value].length, 20);
  assert.ok(img.lines[0].value.endsWith('…'));
});

test('ホームの知らせ：12月はその年、1月は前の年。その年の杯が10杯から', () => {
  assert.equal(NOTICE_MIN_CUPS, 10);
  const brews = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, at: local(2026, 5, 1 + i) }));
  assert.deepEqual(wrappedNotice({ brews, now: new Date(2026, 11, 1, 9) }), { year: '2026', key: '2026' });
  assert.deepEqual(wrappedNotice({ brews, now: new Date(2027, 0, 31, 22) }), { year: '2026', key: '2026' });
  assert.equal(wrappedNotice({ brews, now: new Date(2026, 10, 30, 9) }), null, '11月は出さない');
  assert.equal(wrappedNotice({ brews, now: new Date(2027, 1, 1, 9) }), null, '2月は出さない');
  assert.equal(wrappedNotice({ brews: brews.slice(1), now: new Date(2026, 11, 1) }), null, '9杯では出さない');
  assert.equal(wrappedNotice({ brews: brews.map((b) => ({ ...b, deletedAt: 'x' })), now: new Date(2026, 11, 1) }), null);
});
