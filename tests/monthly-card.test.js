import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyReport, prefChangeText, reportMonths, monthLabel, isMonth } from '../js/core/monthly.js';
import { recipeCardText, canisterLabelText, clip, pourLine } from '../js/core/card-text.js';
import { makeDemoData } from '../js/core/demo-data.js';

const at = (m, d, h = 8) => new Date(2026, m - 1, d, h).toISOString();
const bean = (id, o = {}) => ({ id, name: id, roastLevel: 'シティ', origin: { country: 'ケニア' }, priceJpy: 1500, actualWeightG: 200, orderDate: '2026-11-02', deletedAt: null, createdAt: '2026-11-02T00:00:00Z', ...o });
let seq = 0;
function cup(beanId, when, stars) {
  const id = `c${++seq}`;
  return {
    brew: { id, beanId, at: when, deletedAt: null, actual: { doseG: 15, waterG: 225 } },
    tasting: stars == null ? null : { id: `t${id}`, brewId: id, by: 'me', stage: 'warm', stars, deletedAt: null, updatedAt: when },
  };
}

function data(cups, beans) {
  return { brews: cups.map((c) => c.brew), tastings: cups.map((c) => c.tasting).filter(Boolean), beans, orders: [] };
}

test('月の杯数・ベスト3・産地・月またぎ', () => {
  const beans = [bean('A'), bean('B', { roastLevel: 'ハイ', origin: { country: 'エチオピア' } }), bean('C', { origin: {} })];
  const cups = [
    cup('A', at(10, 31, 23), 5), // 先月
    cup('A', at(11, 1, 6), 4),
    cup('A', at(11, 3), 5),
    cup('B', at(11, 5), 5),
    cup('B', at(11, 6), 3),
    cup('C', at(11, 30, 22), null),
    cup('A', at(12, 1, 0, 30), 5), // 来月
  ];
  const r = monthlyReport({ ...data(cups, beans), month: '2026-11' });
  assert.equal(r.cups, 5);
  assert.equal(r.days, 5);
  assert.equal(r.beansUsed, 3);
  assert.equal(r.label, '2026年11月');
  // 同じ★5 は新しい杯が先
  assert.deepEqual(r.best.map((b) => [b.beanName, b.stars, b.ymd]), [
    ['B', 5, '2026-11-05'],
    ['A', 5, '2026-11-03'],
    ['A', 4, '2026-11-01'],
  ]);
  assert.deepEqual(r.origins, [
    { key: 'ケニア', cups: 2 },
    { key: 'エチオピア', cups: 2 },
    { key: '産地なし', cups: 1 },
  ].sort((a, b) => b.cups - a.cups || a.key.localeCompare(b.key, 'ja')));
  assert.equal(r.avgStars, 4.3);
  assert.equal(r.prevAvgStars, 5);
  // 支出：11月に注文した3袋（1500円×3）
  assert.equal(r.spend.boughtJpy, 4500);
  assert.equal(r.spend.bags, 3);
  assert.ok(r.spend.drankJpy > 0);
});

test('好みの変化：先月と焙煎度・平均の★を比べる', () => {
  assert.deepEqual(prefChangeText({ now: { key: 'ハイ', avg: 4.5, n: 3 }, before: { key: 'シティ', avg: 4, n: 2 }, avg: 4.2, prevAvg: 3.8 }), [
    '平均の★は先月の3.8から4.2に上がりました',
    'いちばん好きな焙煎度が「シティ」から「ハイ」（★4.5）に変わりました',
  ]);
  assert.deepEqual(prefChangeText({ now: { key: 'ハイ', avg: 4.5, n: 3 }, before: null, avg: 4, prevAvg: 4 }), [
    '平均の★は先月と同じ4でした',
    '今月いちばん★が高かった焙煎度は「ハイ」（★4.5、3杯）',
  ]);
  assert.match(prefChangeText({ now: null, before: null, avg: null, prevAvg: null })[0], /2杯以上/);
});

test('記録のない月でも0で出る', () => {
  const r = monthlyReport({ brews: [], beans: [], tastings: [], month: '2026-02' });
  assert.equal(r.cups, 0);
  assert.equal(r.avgStars, null);
  assert.equal(r.caffeinePerDayMg, null);
  assert.deepEqual(r.best, []);
});

test('選べる月とラベル', () => {
  const brews = [{ at: at(9, 15), deletedAt: null }, { at: at(11, 2), deletedAt: null }, { at: at(7, 1), deletedAt: '2026-07-02' }];
  assert.deepEqual(reportMonths(brews, '2026-11-18'), ['2026-11', '2026-09']);
  assert.equal(monthLabel('2027-01'), '2027年1月');
  assert.equal(isMonth('2026-13'), false);
  assert.equal(isMonth('2026-12'), true);
});

test('デモデータで全部の項目が出る', () => {
  const demo = makeDemoData(new Date(2026, 10, 18, 12));
  const months = reportMonths(demo.brews, '2026-11-18');
  const r = monthlyReport({ ...demo, month: months[0] });
  assert.ok(r.cups > 0);
  assert.equal(r.best.length, 3);
  assert.ok(r.origins.length > 0);
});

test('レシピカード：名刺は切り詰めてメモなし、A6はメモまで', () => {
  const recipe = {
    name: 'とても長い名前のレシピでカードに入りきらないかもしれない',
    doseG: 15,
    waterG: 225,
    tempC: 92,
    grind: { setting: '24' },
    pours: [
      { atSec: 0, toG: 45 },
      { atSec: 45, toG: 135, style: 'noji' },
      { atSec: 90, toG: 225 },
    ],
    targetTotalSec: 210,
    template: { kind: 'basic', pourCount: 3 },
    memo: 'メモ',
  };
  const card = recipeCardText({ recipe, bean: { name: 'ケニア', roastLevel: 'シティ' }, grinderName: 'C40', size: 'card' });
  assert.equal([...card.title].length, 18);
  assert.ok(card.title.endsWith('…'));
  assert.equal(card.bean, 'ケニア・シティ');
  assert.equal(card.summary, '15g・225g（1:15）・92℃');
  assert.equal(card.gear, '挽き目 C40 24');
  assert.deepEqual(card.pours, ['0:00　蒸らし　45gまで', '0:45　2投目　135gまで（の字）', '1:30　3投目　225gまで']);
  assert.equal(card.target, '落ち切り 3:30');
  assert.equal(card.memo, '');
  assert.equal(recipeCardText({ recipe, size: 'a6' }).memo, 'メモ');
  assert.equal(clip('abc', 3), 'abc');
  assert.equal(pourLine({ atSec: 5, toG: 10, style: 'x' }, 1), '0:05　2投目　10gまで');
});

test('キャニスターのラベル', () => {
  const t = canisterLabelText({ name: 'ケニア', roastLevel: 'シティ', origin: { country: 'ケニア' }, roastDate: '2026-11-10' });
  assert.deepEqual(t, { title: 'ケニア', sub: 'シティ・ケニア', roast: '焙煎 11/10', howTo: 'アプリの「QRを読む」で抽出へ' });
});

test('月を指定せずに開いたら、月の1〜3日で今月まだ淹れていなければ先月（総仕上げの72番）', async () => {
  const { defaultReportMonth } = await import('../js/core/monthly.js');
  const months = ['2026-12', '2026-11'];
  assert.equal(defaultReportMonth('2026-12-01', months, [{ at: '2026-11-30T10:00:00', deletedAt: null }]), '2026-11');
  assert.equal(defaultReportMonth('2026-12-01', months, [{ at: '2026-12-01T07:00:00', deletedAt: null }]), '2026-12');
  assert.equal(defaultReportMonth('2026-12-04', months, []), '2026-12');
});
