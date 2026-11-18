// 表計算用のCSV書き出し（G1）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv, brewRows, beanRowsCsv, csvFileName, BOM } from '../js/core/csv.js';
import { makeSampleData } from '../js/core/sample-data.js';
import { freshness } from '../js/core/freshness.js';

const NOW = new Date('2026-11-18T03:00:00Z');

test('カンマ・改行・「"」を含む値は "" で囲み、" は2つにする', () => {
  assert.equal(csvCell('ふつう'), 'ふつう');
  assert.equal(csvCell('甘い,酸っぱい'), '"甘い,酸っぱい"');
  assert.equal(csvCell('1行目\n2行目'), '"1行目\n2行目"');
  assert.equal(csvCell('「"さわやか"」'), '"「""さわやか""」"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(true), 'はい');
});

test('Excelで文字化けしない形：先頭にBOM、行の区切りはCRLF', () => {
  const s = toCsv([
    ['a', 'b'],
    ['1', '改行\nあり'],
  ]);
  assert.ok(s.startsWith(BOM));
  assert.equal(s, `${BOM}a,b\r\n1,"改行\nあり"\r\n`);
});

test('抽出の一覧：1杯1行で、豆・計画・実績・評価・提案が入る', () => {
  const data = makeSampleData(NOW);
  const rows = brewRows(data);
  const [head, row] = rows;
  assert.equal(rows.length, 2);
  assert.equal(row.length, head.length);
  const col = (name) => row[head.indexOf(name)];
  assert.equal(col('豆'), 'サンプル エチオピア');
  assert.equal(col('レシピ'), '4:6メソッド（サンプル）');
  assert.equal(col('計画 挽き目'), '24'); // 古い形（文字列）の計画も読める
  assert.equal(col('粉量g'), 20.1);
  assert.equal(col('総時間'), '3:35');
  assert.equal(col('グラインダー'), 'サンプル 手挽きミル');
  assert.equal(col('★'), 4);
  assert.equal(col('一言'), '酸っぱい');
  assert.equal(col('酸味'), 'やや強い');
  assert.equal(col('甘さ'), 'やや弱い');
  assert.equal(col('この杯への提案'), '挽き目を1目盛り細かく：挽き目 24 → 23');
  assert.equal(col('使った提案'), '');
  assert.equal(col('抽出ID'), data.brews[0].id);
});

test('抽出の一覧：評価・提案・豆のない抽出は空欄、削除済みは出さず古い順', () => {
  const brews = [
    { id: 'b2', at: '2026-11-18T01:00:00Z', deletedAt: null, actual: { doseG: 15 }, timerUsed: false, suggestionId: 's1' },
    { id: 'b1', at: '2026-11-17T01:00:00Z', deletedAt: null, actual: {} },
    { id: 'b0', at: '2026-11-16T01:00:00Z', deletedAt: '2026-11-17T00:00:00Z', actual: {} },
  ];
  const suggestions = [{ id: 's1', brewId: 'b1', deletedAt: null, adopted: true, updatedAt: 'x', action: { text: '湯を増やす' } }];
  const [head, r1, r2, r3] = brewRows({ brews, suggestions });
  assert.equal(r3, undefined);
  assert.equal(r1[head.indexOf('抽出ID')], 'b1');
  assert.equal(r1[head.indexOf('この杯への提案')], '湯を増やす（使った）');
  assert.equal(r2[head.indexOf('使った提案')], '湯を増やす');
  assert.equal(r2[head.indexOf('豆')], '');
  assert.equal(r2[head.indexOf('★')], '');
  assert.equal(r2[head.indexOf('タイマー')], false);
});

test('豆の一覧：残量（常温＋冷凍）・残り杯数・飲み頃が入る', () => {
  const data = makeSampleData(NOW);
  const [head, row] = beanRowsCsv({ beans: data.beans, txs: data.inventoryTx, portions: data.frozenPortions, doseG: 15, today: '2026-11-18' });
  const col = (name) => row[head.indexOf(name)];
  assert.equal(col('名前'), 'サンプル エチオピア');
  assert.equal(col('表記の基準'), '生豆時');
  assert.equal(col('残量g'), 146.4);
  assert.equal(col('残り杯数'), 9);
  assert.equal(col('常温g'), 116.4);
  assert.equal(col('冷凍g'), 30);
  assert.equal(col('冷凍の袋数'), 2);
  assert.equal(col('状態'), '開封済み');
  assert.equal(col('飲み頃'), freshness(data.beans[0].roastDate, 'シティ', '2026-11-18').label);
  assert.equal(col('焙煎日'), data.beans[0].roastDate);
});

test('CSVのファイル名は種類と日時入り', () => {
  const d = new Date(2026, 10, 18, 7, 5);
  assert.equal(csvFileName('brews', d), 'pourfolio-brews-20261118-0705.csv');
});
