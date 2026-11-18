import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayPicks, caffeineState, minutesOf, normalizeCutoff, bestBrewOf, pickHref, baseText, DAILY_CAFFEINE_MG } from '../js/core/today.js';
import { beanRows } from '../js/core/home.js';
import { makeDemoData } from '../js/core/demo-data.js';
import { analysisRows } from '../js/core/analysis.js';

const TODAY = '2026-11-18';
const NOON = new Date(2026, 10, 18, 12, 0);

let seq = 0;
function bean(o = {}) {
  const id = o.id ?? `b${++seq}`;
  return { id, name: o.name ?? id, roastLevel: 'シティ', roastDate: '2026-11-12', process: 'ウォッシュト', origin: { country: 'ブラジル' }, status: 'open', deletedAt: null, updatedAt: '2026-11-01', ...o };
}
const stock = (beanId, g) => ({ id: `tx-${beanId}`, beanId, deltaG: g, kind: 'in', at: '2026-11-10T00:00:00Z', deletedAt: null });
let wseq = 0;
function rated(beanId, stars, o = {}) {
  const id = `w${++wseq}`;
  return {
    brew: { id, beanId, at: o.at ?? `2026-11-${String(10 + (wseq % 8)).padStart(2, '0')}T08:00:00Z`, deletedAt: null, context: o.iced ? { iceG: 100 } : {}, planned: {}, actual: {} },
    tasting: { id: `t${id}`, brewId: id, by: 'me', stage: 'warm', stars, deletedAt: null, updatedAt: '2026-11-01' },
  };
}

function setup(beans, cupsList, extra = {}) {
  const txs = beans.map((b, i) => stock(b.id, (cupsList[i] ?? 10) * 15));
  const rows = beanRows({ beans, txs, portions: extra.portions ?? [], doseG: 15, today: TODAY });
  const ratedList = extra.rated ?? [];
  return {
    rows,
    beans,
    brews: ratedList.map((x) => x.brew),
    tastings: ratedList.map((x) => x.tasting),
    now: extra.now ?? NOON,
  };
}

test('時刻の読み方', () => {
  assert.equal(minutesOf('15:30'), 930);
  assert.equal(minutesOf('25:00'), null);
  assert.equal(minutesOf(''), null);
  assert.equal(normalizeCutoff('９:05'), '09:05');
  assert.equal(normalizeCutoff('あとで'), null);
});

test('カフェインを控える状態：時刻を過ぎた・夜中・1日の目安に届いた', () => {
  assert.equal(caffeineState({ now: NOON, cutoff: '15:00' }).late, false);
  assert.equal(caffeineState({ now: new Date(2026, 10, 18, 15, 0), cutoff: '15:00' }).late, true);
  assert.equal(caffeineState({ now: new Date(2026, 10, 18, 2, 0), cutoff: '15:00' }).late, true);
  assert.equal(caffeineState({ now: new Date(2026, 10, 18, 2, 0), cutoff: null }).late, false);
  const s = caffeineState({ now: NOON, todayCaffeineMg: DAILY_CAFFEINE_MG });
  assert.equal(s.late, true);
  assert.match(s.why, /400mg/);
});

test('★の高い豆が上に来て、すべての候補に理由が付く（3つまで）', () => {
  const beans = [bean({ id: 'a', name: 'A' }), bean({ id: 'b', name: 'B' }), bean({ id: 'c', name: 'C' }), bean({ id: 'd', name: 'D' })];
  const r = [rated('a', 5), rated('a', 5), rated('a', 4), rated('b', 2), rated('b', 3), rated('c', 4)];
  const picks = todayPicks({ ...setup(beans, [10, 10, 10, 10], { rated: r }) });
  assert.equal(picks.length, 3);
  assert.equal(picks[0].bean.id, 'a');
  assert.ok(picks.every((p) => p.reasons.length >= 2 && p.reasons.every((t) => typeof t === 'string' && t.length > 0)));
  assert.match(picks[0].reasons[0], /この豆の★平均 4\.7（3杯）/);
  assert.match(picks[0].reasons[1], /飲み頃です（焙煎から6日）/);
  assert.equal(picks[0].base.kind, 'brew');
  assert.ok(!picks.some((p) => p.bean.id === 'b'));
});

test('飲み切り・入荷待ち・残り1杯に足りない豆は出さない。豆がなければ空', () => {
  const beans = [bean({ id: 'f', status: 'finished' }), bean({ id: 'o', status: 'ordered' }), bean({ id: 'e' }), bean({ id: 'ok' })];
  const s = setup(beans, [10, 10, 0, 10]);
  assert.deepEqual(todayPicks(s).map((p) => p.bean.id), ['ok']);
  assert.deepEqual(todayPicks({ ...s, rows: [] }), []);
});

test('同じ★なら、早めに消費・残りわずかの豆が上、休ませ中は下', () => {
  const beans = [
    bean({ id: 'rest', name: 'R', roastDate: '2026-11-17' }), // シティ：1日目まで休ませ中
    bean({ id: 'peak', name: 'P', roastDate: '2026-11-12' }),
    bean({ id: 'old', name: 'O', roastDate: '2026-10-01' }), // 早めに消費
    bean({ id: 'low', name: 'L', roastDate: '2026-11-01' }), // ピーク後・残り2杯
  ];
  const picks = todayPicks({ ...setup(beans, [10, 10, 10, 2]), n: 4 });
  assert.deepEqual(picks.map((p) => p.bean.id), ['old', 'peak', 'low', 'rest']);
  assert.match(picks[0].reasons.join(), /早めに使い切りたい/);
  assert.match(picks[2].reasons.join(), /残り2杯で使い切れます/);
  assert.match(picks[3].reasons.join(), /休ませ中です（あと1日で飲み頃）/);
});

test('まだ評価のない豆は、産地・精製・焙煎度の好みから予測する', () => {
  const beans = [bean({ id: 'k1', origin: { country: 'ケニア' } }), bean({ id: 'k2', origin: { country: 'ケニア' } }), bean({ id: 'br', origin: { country: 'ブラジル' } }), bean({ id: 'br2', origin: { country: 'ブラジル' } })];
  const r = [rated('k1', 5), rated('k1', 5), rated('k1', 5), rated('br', 2), rated('br', 2), rated('br', 2)];
  const picks = todayPicks({ ...setup(beans, [10, 10, 10, 10], { rated: r }), n: 4 });
  const k2 = picks.find((p) => p.bean.id === 'k2');
  const br2 = picks.find((p) => p.bean.id === 'br2');
  assert.ok(k2.predicted > br2.predicted);
  assert.match(k2.reasons[0], /まだ評価がないので、好み（ケニア・ウォッシュト・シティ）から/);
  assert.equal(k2.base.kind, 'initial');
});

test('冷凍の袋だけの豆は少し下げる', () => {
  const beans = [bean({ id: 'fz', name: 'F' }), bean({ id: 'rm', name: 'R' })];
  const s = setup(beans, [0, 10], { portions: [{ id: 'p1', beanId: 'fz', grams: 15, labelNo: 1, frozenAt: '2026-11-01', takenAt: null, deletedAt: null }, { id: 'p2', beanId: 'fz', grams: 15, labelNo: 2, frozenAt: '2026-11-01', takenAt: null, deletedAt: null }] });
  const picks = todayPicks(s);
  assert.deepEqual(picks.map((p) => p.bean.id), ['rm', 'fz']);
  assert.match(picks[1].reasons.join(), /冷凍の袋だけ/);
});

test('気分：目覚めは浅煎り・中煎りを、食後は深めを少し上げる。理由に気分が出る', () => {
  const beans = [bean({ id: 'lt', name: 'L', roastLevel: 'シナモン', roastDate: '2026-11-10' }), bean({ id: 'dk', name: 'D', roastLevel: 'フレンチ', roastDate: '2026-11-15' })];
  const s = setup(beans, [10, 10]);
  assert.equal(todayPicks({ ...s, mood: 'wake' })[0].bean.id, 'lt');
  const meal = todayPicks({ ...s, mood: 'meal' });
  assert.equal(meal[0].bean.id, 'dk');
  assert.match(meal[0].reasons.join(), /気分「食後」（ボディ重視）に合う深煎り/);
  assert.equal(meal[0].mood, 'meal');
});

test('気分：来客は★の安定した定番を上げ、2杯にする', () => {
  const beans = [bean({ id: 'new', name: 'N' }), bean({ id: 'std', name: 'S' })];
  const r = [rated('std', 4), rated('std', 4), rated('std', 4), rated('std', 4)];
  const picks = todayPicks({ ...setup(beans, [10, 10], { rated: r }), mood: 'guest' });
  assert.equal(picks[0].bean.id, 'std');
  assert.equal(picks[0].cups, 2);
  assert.match(picks[0].reasons.join(), /定番/);
  assert.match(picks[1].reasons.join(), /来客には少し不安/);
});

test('控える時刻を過ぎたら、カフェインレスが上に来て、ほかの豆は少なめ（0.7杯）', () => {
  const beans = [bean({ id: 'reg', name: 'R' }), bean({ id: 'dec', name: 'D', decaf: true })];
  const r = [rated('reg', 5), rated('reg', 5), rated('dec', 3)];
  const s = setup(beans, [10, 10], { rated: r });
  const day = todayPicks({ ...s, cutoff: '15:00' });
  assert.equal(day[0].bean.id, 'reg');
  assert.equal(day[0].cups, 1);
  const night = todayPicks({ ...s, cutoff: '15:00', now: new Date(2026, 10, 18, 20, 0) });
  assert.equal(night[0].bean.id, 'dec');
  assert.match(night[0].reasons.join(), /カフェインレスです（15:00を過ぎた/);
  assert.equal(night[1].cups, 0.7);
  assert.match(night[1].reasons.join(), /少なめ/);
  assert.match(pickHref(night[1]), /cups=0\.7/);
});

test('いちばん★の高い杯：アイスは除き、同じ★なら新しい杯', () => {
  const a = rated('x', 5, { at: '2026-11-01T00:00:00Z' });
  const b = rated('x', 5, { at: '2026-11-05T00:00:00Z' });
  const c = rated('x', 5, { at: '2026-11-09T00:00:00Z', iced: true });
  const d = rated('x', 3, { at: '2026-11-10T00:00:00Z' });
  const list = [a, b, c, d].map((x) => ({ brew: x.brew, stars: x.tasting.stars }));
  assert.equal(bestBrewOf(list).id, b.brew.id);
  assert.equal(bestBrewOf([{ brew: c.brew, stars: 5 }]), null);
});

test('淹れる画面へのURLと淹れ方の一言', () => {
  assert.equal(pickHref({ bean: { id: 'b1' }, base: { kind: 'brew', brewId: 'w1' }, mood: null, cups: 1 }), 'brew.html?brew=w1&bean=b1');
  assert.equal(pickHref({ bean: { id: 'b1' }, base: { kind: 'initial' }, mood: 'guest', cups: 2 }), 'brew.html?initial=b1&bean=b1&mood=guest&cups=2');
  assert.match(baseText({ base: { kind: 'initial' } }), /最初のレシピ/);
});

test('デモデータ（80杯）でも、理由付きの候補が3つ出る', () => {
  const demo = makeDemoData(new Date(2026, 10, 18, 9, 0));
  const rows = beanRows({ beans: demo.beans, txs: demo.inventoryTx, portions: demo.frozenPortions ?? [], doseG: 15, today: TODAY });
  const caf = analysisRows(demo);
  assert.ok(caf.length > 0);
  const picks = todayPicks({ rows, brews: demo.brews, tastings: demo.tastings, beans: demo.beans, now: new Date(2026, 10, 18, 9, 0), mood: 'wake' });
  assert.ok(picks.length >= 1 && picks.length <= 3);
  for (const p of picks) {
    assert.ok(p.reasons.length >= 1);
    assert.ok(Number.isFinite(p.score));
  }
});

test('キャニスターのQR：その豆で★がいちばん高いホットの杯', async () => {
  const { bestBrewForBean } = await import('../js/core/today.js');
  const a = rated('qa', 3);
  const b = rated('qa', 5);
  const c = rated('qa', 5, { iced: true });
  const d = rated('qz', 5);
  const brews = [a, b, c, d].map((x) => x.brew);
  const tastings = [a, b, c, d].map((x) => x.tasting);
  assert.equal(bestBrewForBean(brews, tastings, 'qa').id, b.brew.id);
  assert.equal(bestBrewForBean(brews, tastings, 'none'), null);
});
