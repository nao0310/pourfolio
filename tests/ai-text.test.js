import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConsultText, parseAnswer, findBeanByName, brewTable, preferenceLines, stockLines, equipmentLines, QUESTIONS, ANSWER_HEAD } from '../js/core/ai-text.js';
import { makeDemoData } from '../js/core/demo-data.js';
import { beanRows } from '../js/core/home.js';

const NOW = new Date(2026, 10, 18, 9, 0);
const demo = makeDemoData(NOW);
const rows = beanRows({ beans: demo.beans, txs: demo.inventoryTx, portions: [], doseG: 15, today: '2026-11-18' });
const all = { brews: demo.brews, tastings: demo.tastings, beans: demo.beans, rows, equipment: demo.equipment, now: NOW };

test('相談テキストに、質問・直近の表・好み・手元の豆・器具・答えの形が入る', () => {
  const text = buildConsultText({ ...all, question: 'next', extra: '朝は時間がありません' });
  for (const h of ['## 質問', '## 直近の抽出', '## 好み', '## 手元の豆', '## 器具', '## 答え方のお願い', ANSWER_HEAD, '粉量：○g']) assert.ok(text.includes(h), h);
  assert.ok(text.includes(QUESTIONS.next.text));
  assert.ok(text.includes('朝は時間がありません'));
  // 表は見出し2行＋14杯
  assert.equal(text.split('\n').filter((l) => l.startsWith('| 20')).length, 14);
});

test('メモ（自由に書いた文）は入れない', () => {
  const brews = demo.brews.map((b, i) => (i === 0 ? { ...b, memo: '秘密のメモ' } : b));
  const tastings = demo.tastings.map((t) => ({ ...t, memo: '個人的なメモ' }));
  const text = buildConsultText({ ...all, brews, tastings });
  assert.ok(!text.includes('秘密のメモ'));
  assert.ok(!text.includes('個人的なメモ'));
});

test('「この豆に合う淹れ方」はその豆の杯だけを表にし、質問に豆の名前が入る', () => {
  const bean = demo.beans[0];
  const text = buildConsultText({ ...all, question: 'bean', bean });
  assert.ok(text.includes(`「${bean.name}」に合う淹れ方`));
  const lines = text.split('\n').filter((l) => l.startsWith('| 20'));
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => l.includes(bean.name)));
});

test('「次に何を買う」は提案レシピの形を求めない', () => {
  const text = buildConsultText({ ...all, question: 'buy' });
  assert.ok(!text.includes(ANSWER_HEAD));
  assert.ok(text.includes('珈琲問屋'));
});

test('記録がないときも形が崩れない', () => {
  const text = buildConsultText({ question: 'next', now: NOW });
  assert.ok(text.includes('（まだ抽出の記録がありません）'));
  assert.ok(text.includes('（手元に豆がありません）'));
  assert.ok(text.includes('（器具の登録なし）'));
  assert.deepEqual(preferenceLines({}), ['- （★のある記録がまだ少なく、好みは出せません）']);
});

test('表の行：アイスの杯は湯と氷を分け、| は全角に置き換える', () => {
  const beans = [{ id: 'b', name: 'A|B', roastLevel: 'シティ', deletedAt: null }];
  const brews = [{ id: 'w', beanId: 'b', at: '2026-11-18T00:00:00Z', deletedAt: null, context: { iceG: 100 }, actual: { doseG: 20, waterG: 180, tempC: 90, grind: { setting: '22' }, totalSec: 150 }, derived: { daysOffRoast: 7 } }];
  const tastings = [{ id: 't', brewId: 'w', by: 'me', stage: 'warm', stars: 4, jar: { acidity: 1, strength: 0 }, tags: ['甘い'], deletedAt: null, updatedAt: 'x' }];
  const [, , line] = brewTable({ brews, tastings, beans });
  assert.match(line, /A／B/);
  assert.match(line, /180g＋氷100g/);
  assert.match(line, /1:14（氷込み）/);
  assert.match(line, /酸味やや強い/);
  assert.ok(!/濃さ/.test(line));
  assert.match(line, /2:30/);
});

test('手元の豆と器具の行', () => {
  const lines = stockLines([{ bean: { name: 'X', roastLevel: 'ハイ', origin: { country: 'ケニア' }, decaf: true }, cups: 4, freshness: { label: '飲み頃', days: 6 } }]);
  assert.deepEqual(lines, ['- X（ハイ・ケニア）・カフェインレス：残り4杯、飲み頃（焙煎から6日）']);
  assert.match(equipmentLines([{ kind: 'grinder', name: 'C40', attrs: { step: 1 }, deletedAt: null }])[0], /グラインダー：C40（目盛りの刻み 1/);
});

test('答えの読み取り：決まった形を読み、全角の数字や「約」も読む', () => {
  const r = parseAnswer(`いい感じです。\n\n【提案レシピ】\n豆：ケニア ニエリ\n粉量：２０ｇ\n湯量：約300g\n湯温: 91℃\n挽き目：23（1目盛り細かく）\n理由：酸味が強いので細かくします。`);
  assert.equal(r.found, true);
  assert.deepEqual(r.overrides, { doseG: 20, waterG: 300, tempC: 91, grind: '23' });
  assert.equal(r.beanName, 'ケニア ニエリ');
  assert.equal(r.reason, '酸味が強いので細かくします。');
});

test('答えの読み取り：欠けた行・範囲の外は入れない。何も読めなければ found=false', () => {
  const r = parseAnswer('【提案レシピ】\n粉量：200g\n湯温：92℃');
  assert.deepEqual(r.overrides, { tempC: 92 });
  assert.equal(r.found, true);
  const none = parseAnswer('挽き目を少し細かくしてみてください。');
  assert.equal(none.found, false);
  assert.deepEqual(none.overrides, {});
});

test('豆の名前で探す：完全一致 → 含む', () => {
  const beans = [{ id: '1', name: 'ケニア ニエリ' }, { id: '2', name: 'ケニア' }];
  assert.equal(findBeanByName('ケニア', beans).id, '2');
  assert.equal(findBeanByName('ケニア ニエリ（シティ）', beans).id, '1');
  assert.equal(findBeanByName('', beans), null);
  assert.equal(findBeanByName('ブラジル', beans), null);
});
