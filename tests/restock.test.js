import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  restDaysFor,
  stockSummary,
  restockPlan,
  restockText,
  shoppingCandidates,
  orderMemo,
  bulkBuyPlan,
  bulkBuyText,
  normalizeShippingInput,
  RESTOCK_SOON_DAYS,
} from '../js/core/restock.js';

const NOW = new Date('2026-11-18T12:00:00Z');
const TODAY = '2026-11-18';
const iso = (daysAgo) => new Date(NOW.getTime() - daysAgo * 86400000).toISOString();
let seq = 0;
const bean = (id, extra = {}) => ({ id, name: id, roastLevel: 'シティ', status: 'open', labelWeightG: 200, labelWeightBasis: 'green', createdAt: iso(30), deletedAt: null, ...extra });
const tx = (beanId, deltaG, kind = 'in', daysAgo = 20, extra = {}) => ({ id: `t${(seq += 1)}`, beanId, deltaG, kind, at: iso(daysAgo), deletedAt: null, ...extra });
/** 直近14日で1日15gずつ（14杯）飲んだ履歴 */
const dailyBrews = (beanId, n = 14, g = 15) => Array.from({ length: n }, (_, i) => tx(beanId, -g, 'brew', 14 - i));

test('休ませる日数は焙煎度の区分で決まる（わからなければ中煎り）', () => {
  assert.equal(restDaysFor('ライト'), 4);
  assert.equal(restDaysFor('ハイ'), 2);
  assert.equal(restDaysFor('シティ'), 1);
  assert.equal(restDaysFor('イタリアン'), 0);
  assert.equal(restDaysFor(''), 2);
});

test('在庫の合計：手元の残量と、入荷待ちの見積もり。飲み切り・削除済みは数えない', () => {
  const beans = [
    bean('a'),
    bean('b', { status: 'finished' }),
    bean('c', { status: 'ordered', labelWeightG: 200, roastLevel: 'シティ' }),
    bean('d', { deletedAt: iso(1) }),
    bean('e'),
  ];
  const txs = [tx('a', 160), tx('a', -15, 'brew', 1), tx('b', 100), tx('d', 100), tx('e', 10), tx('e', -30, 'brew', 1)];
  const s = stockSummary({ beans, txs });
  assert.equal(s.onHandG, 145, 'マイナスになった豆は0として数える');
  assert.equal(s.incomingG, 164, '生豆時200g・シティの目減り18%');
  assert.equal(s.orderedCount, 1);
});

test('ペースがわからないときは unknown（2週間で2杯未満）', () => {
  const plan = restockPlan({ beans: [bean('a')], txs: [tx('a', 160), tx('a', -15, 'brew', 1)], today: TODAY, now: NOW });
  assert.equal(plan.status, 'unknown');
  assert.match(restockText(plan).text, /2週間で2杯以上/);
});

test('なくなる日と注文の目安日：在庫÷ペースから、お届け日数と休ませる日数を引く', () => {
  // 手元 300g − 14杯×15g = 90g、ペース 15g/日 → あと6日。お届け5日＋休ませ1日（シティ）→ 今日が目安
  const beans = [bean('a')];
  const txs = [tx('a', 300), ...dailyBrews('a')];
  const plan = restockPlan({ beans, txs, settings: { deliveryDays: 5 }, today: TODAY, now: NOW });
  assert.equal(plan.gPerDay, 15);
  assert.equal(plan.daysLeft, 6);
  assert.equal(plan.runoutYmd, '2026-11-24');
  assert.equal(plan.deliveryDays, 5);
  assert.equal(plan.restDays, 1);
  assert.equal(plan.daysUntilOrder, 0);
  assert.equal(plan.status, 'now');
  assert.equal(plan.orderByYmd, TODAY);
  assert.match(restockText(plan).title, /今日、注文/);
});

test('境目：目安日まで3日以内は「そろそろ」、それより先は ok', () => {
  const at = (onHand) =>
    restockPlan({ beans: [bean('a')], txs: [tx('a', onHand + 210), ...dailyBrews('a')], settings: { deliveryDays: 5 }, today: TODAY, now: NOW });
  // daysLeft − 6 = daysUntilOrder
  const soon = at(15 * (6 + RESTOCK_SOON_DAYS));
  assert.equal(soon.daysUntilOrder, RESTOCK_SOON_DAYS);
  assert.equal(soon.status, 'soon');
  assert.equal(restockText(soon).title, 'そろそろ注文：11/21までに');
  const ok = at(15 * (6 + RESTOCK_SOON_DAYS + 1));
  assert.equal(ok.status, 'ok');
  assert.equal(restockText(ok).title, '次の注文は11/22ごろ');
  const late = at(0);
  assert.equal(late.status, 'now');
  assert.equal(late.orderByYmd, TODAY, '過ぎていても今日にする');
});

test('お届け日数の初期値は7日（設定も実績もないとき）', () => {
  const plan = restockPlan({ beans: [bean('a')], txs: [tx('a', 300), ...dailyBrews('a')], today: TODAY, now: NOW });
  assert.equal(plan.deliveryDays, 7);
  assert.equal(plan.deliveryLearned, false);
  assert.equal(plan.status, 'now', 'あと6日分では、7日のお届けに間に合わない');
  assert.match(restockText(plan).text, /お届け7日/);
});

test('入荷待ちの豆も在庫に含める。設定のお届け日数と、実績のお届け日数', () => {
  const beans = [bean('a'), bean('c', { status: 'ordered' })];
  const txs = [tx('a', 300), ...dailyBrews('a')];
  const plan = restockPlan({ beans, txs, settings: { deliveryDays: 3 }, today: TODAY, now: NOW });
  assert.equal(plan.daysLeft, Math.floor((90 + 164) / 15));
  assert.equal(plan.deliveryDays, 3);
  assert.match(restockText(plan).text, /入荷待ちを含む/);
  // 2回の注文の実績（4日・6日）→ 中央値5日
  const learned = [
    bean('x', { status: 'finished', orderId: 'o1', orderDate: '2026-10-01', arrivalDate: '2026-10-05' }),
    bean('y', { status: 'finished', orderId: 'o2', orderDate: '2026-10-20', arrivalDate: '2026-10-26' }),
  ];
  const p2 = restockPlan({ beans: [...beans, ...learned], txs, settings: { deliveryDays: 3 }, today: TODAY, now: NOW });
  assert.equal(p2.deliveryDays, 5);
  assert.equal(p2.deliveryLearned, true);
});

test('買い物リスト：銘柄＋焙煎度でまとめ、★の平均が高い順。評価なしは後ろ', () => {
  const beans = [
    bean('b1', { name: 'エチオピア', roastLevel: 'ミディアム', status: 'finished', priceJpy: 1100, productUrl: 'https://example.com/eth', createdAt: iso(40), orderDate: '2026-10-01' }),
    bean('b2', { name: 'エチオピア', roastLevel: 'ミディアム', priceJpy: 1200, createdAt: iso(10), orderDate: '2026-11-01' }),
    bean('b3', { name: 'エチオピア', roastLevel: 'フルシティ', status: 'finished', createdAt: iso(20) }),
    bean('b4', { name: 'ケニア', roastLevel: 'シティ', status: 'finished', createdAt: iso(25) }),
    bean('b5', { name: 'ブラジル', roastLevel: 'シティ', createdAt: iso(5) }),
    bean('gone', { name: '消した豆', deletedAt: iso(1) }),
  ];
  const brews = [
    { id: 'r1', beanId: 'b1', deletedAt: null },
    { id: 'r2', beanId: 'b2', deletedAt: null },
    { id: 'r3', beanId: 'b3', deletedAt: null },
    { id: 'r4', beanId: 'b4', deletedAt: null },
    { id: 'r5', beanId: 'b4', deletedAt: null },
  ];
  const t = (brewId, stars) => ({ id: `t-${brewId}`, brewId, stars, by: 'me', stage: 'warm', updatedAt: iso(1), deletedAt: null });
  const tastings = [t('r1', 5), t('r2', 4), t('r3', 3), t('r4', 4), t('r5', 5)];
  const list = shoppingCandidates({ beans, brews, tastings });
  assert.deepEqual(
    list.map((c) => `${c.name}/${c.roastLevel}`),
    ['エチオピア/ミディアム', 'ケニア/シティ', 'エチオピア/フルシティ', 'ブラジル/シティ'],
    '★4.5・評価2件どうしは、最近買ったほう',
  );
  const eth = list[0];
  assert.equal(eth.bags, 2);
  assert.equal(eth.avgStars, 4.5);
  assert.equal(eth.priceJpy, 1200, '新しい袋の値');
  assert.equal(eth.productUrl, 'https://example.com/eth', '新しい袋にURLがなければ前の値');
  assert.equal(eth.lastBoughtYmd, '2026-11-01');
  assert.equal(eth.inStock, true);
  assert.equal(list[1].inStock, false);
  assert.equal(list[3].avgStars, null);
});

test('注文メモ：目安日と、銘柄・焙煎度・重さ・前回の★', () => {
  const picked = [
    { name: 'ケニア', roastLevel: 'シティ', labelWeightG: 200, labelWeightBasis: 'green', avgStars: 4.5 },
    { name: 'ブレンド', roastLevel: '', labelWeightG: 500, labelWeightBasis: 'roasted', avgStars: null },
  ];
  assert.equal(
    orderMemo(picked, { status: 'soon', orderByYmd: '2026-11-21' }),
    '珈琲問屋 注文メモ（11/21までに）\n・ケニア シティ 200g（前回 ★4.5）\n・ブレンド 500g（焙煎後）',
  );
  assert.equal(orderMemo([], { status: 'unknown' }), '珈琲問屋 注文メモ');
});

test('買い物リスト：★が同じなら評価の多いほうが先', () => {
  const beans = [bean('a', { name: 'A', createdAt: iso(5), orderDate: '2026-11-10' }), bean('b', { name: 'B', createdAt: iso(20), orderDate: '2026-10-01' })];
  const brews = [{ id: 'ra', beanId: 'a', deletedAt: null }, { id: 'rb1', beanId: 'b', deletedAt: null }, { id: 'rb2', beanId: 'b', deletedAt: null }];
  const t = (brewId, stars) => ({ id: `t-${brewId}`, brewId, stars, by: 'me', stage: 'warm', updatedAt: iso(1), deletedAt: null });
  const list = shoppingCandidates({ beans, brews, tastings: [t('ra', 4), t('rb1', 4), t('rb2', 4)] });
  assert.deepEqual(list.map((c) => c.name), ['B', 'A']);
});

test('在庫の合計に冷凍の袋を含める（取り出した・削除した袋、飲み切りの豆の袋は数えない）', () => {
  const beans = [bean('a'), bean('b', { status: 'finished' })];
  const txs = [tx('a', 160), tx('a', -60, 'freeze', 2), tx('a', 15, 'thaw', 1), tx('b', 30), tx('b', -30, 'freeze', 3)];
  const portion = (beanId, labelNo, extra = {}) => ({ id: `p${labelNo}`, beanId, labelNo, grams: 15, takenOutAt: null, deletedAt: null, ...extra });
  const portions = [
    portion('a', 1, { takenOutAt: iso(1) }),
    portion('a', 2),
    portion('a', 3),
    portion('a', 4, { deletedAt: iso(1) }),
    portion('a', 6),
    portion('b', 5),
  ];
  const s = stockSummary({ beans, txs, portions });
  assert.equal(s.onHandG, 115 + 45);
  assert.equal(s.frozenG, 45);
  const plan = restockPlan({ beans, txs: [...txs, ...dailyBrews('a', 14, 1)], portions, today: TODAY, now: NOW });
  assert.match(restockText(plan).text, /冷凍を含む/);
});

// ---- 送料無料ラインのまとめ買い案 ----

const cand = (key, priceJpy, extra = {}) => ({ key, name: key, roastLevel: 'シティ', labelWeightG: 100, labelWeightBasis: 'green', priceJpy, ...extra });
const SHIP = { shippingJpy: 600, freeShippingJpy: 3000, freezerSlots: 10 };

test('送料の設定：空欄は未設定、円・カンマ・全角は読む、マイナスや小数は止める', () => {
  assert.deepEqual(normalizeShippingInput({ shippingJpy: '６００円', freeShippingJpy: '3,000', freezerSlots: '' }), {
    value: { shippingJpy: 600, freeShippingJpy: 3000, freezerSlots: null },
    errors: {},
  });
  const bad = normalizeShippingInput({ shippingJpy: '-1', freeShippingJpy: '10.5', freezerSlots: '1000' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['freeShippingJpy', 'freezerSlots', 'shippingJpy']);
});

test('まとめ買い：ラインが未設定・候補を選んでいない・ラインに届いている', () => {
  const candidates = [cand('a', 1500), cand('b', 2000)];
  assert.equal(bulkBuyPlan({ picked: [candidates[0]], candidates, settings: {}, doseG: 15 }).status, 'noLine');
  assert.equal(bulkBuyPlan({ picked: [], candidates, settings: SHIP, doseG: 15 }).status, 'empty');
  const free = bulkBuyPlan({ picked: candidates, candidates, settings: SHIP, doseG: 15 });
  assert.equal(free.status, 'free');
  assert.equal(free.totalJpy, 3500);
  assert.match(bulkBuyText(free), /届いています/);
});

test('まとめ買い：足りない額と、1つで届く候補（★の高い順のまま）。冷凍庫に1杯分ずつ入るか', () => {
  // 候補は★の高い順に並んでいる前提。生豆時100g・シティ → 約82g → 15gずつで6袋
  const candidates = [cand('picked', 1800), cand('cheap', 500), cand('top', 1300), cand('second', 1200), cand('noPrice', null)];
  const b = bulkBuyPlan({ picked: [candidates[0]], candidates, settings: SHIP, portions: [], doseG: 15 });
  assert.equal(b.status, 'short');
  assert.equal(b.shortfallJpy, 1200);
  assert.equal(b.freeSlots, 10);
  assert.deepEqual(
    b.suggestions.map((s) => s.keys),
    [['top'], ['second']],
  );
  assert.equal(b.suggestions[0].addG, 82);
  assert.equal(b.suggestions[0].portionsNeeded, 6);
  assert.equal(b.suggestions[0].fits, true);
  assert.equal(bulkBuyText(b), '合計 1,800円。送料無料まで、あと1,200円。このままだと送料600円がかかります');
});

test('まとめ買い：冷凍庫の空きに入らない案は後ろ。冷凍中の袋は空きから引く。入る数がわからなければ fits は null', () => {
  const candidates = [cand('picked', 2000), cand('big', 1500, { labelWeightG: 500 }), cand('small', 1100)];
  const portions = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, takenOutAt: null, deletedAt: null }));
  portions.push({ id: 'out', takenOutAt: 'x', deletedAt: null });
  const b = bulkBuyPlan({ picked: [candidates[0]], candidates, settings: SHIP, portions, doseG: 15 });
  assert.equal(b.freeSlots, 6);
  assert.deepEqual(
    b.suggestions.map((s) => [s.keys[0], s.fits]),
    [
      ['small', true],
      ['big', false],
    ],
  );
  const unknown = bulkBuyPlan({ picked: [candidates[0]], candidates, settings: { ...SHIP, freezerSlots: null }, doseG: 15 });
  assert.equal(unknown.freeSlots, null);
  assert.ok(unknown.suggestions.every((s) => s.fits === null));
});

test('まとめ買い：1つで届かなければ、★の高い順に足した組み合わせ。それでも届かなければ案なし', () => {
  const candidates = [cand('picked', 500), cand('a', 900), cand('b', 1000), cand('c', 800), cand('d', 700)];
  const b = bulkBuyPlan({ picked: [candidates[0]], candidates, settings: SHIP, doseG: 15 });
  assert.equal(b.shortfallJpy, 2500);
  assert.equal(b.suggestions.length, 1);
  assert.deepEqual(b.suggestions[0].keys, ['a', 'b', 'c'], '届いたところで止める（d は足さない）');
  assert.equal(b.suggestions[0].addJpy, 2700);
  const none = bulkBuyPlan({ picked: [candidates[0]], candidates, settings: { ...SHIP, freeShippingJpy: 10000 }, doseG: 15 });
  assert.deepEqual(none.suggestions, []);
});
