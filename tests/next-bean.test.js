// 次に買う豆（F6）：自分向け度・開拓ボーナス・焙煎度の指定・注文の量とメモ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextBeanCandidates,
  exploreBonus,
  recommendRoast,
  orderGrams,
  priceForGrams,
  nextBeanMemo,
  EXPLORE_BONUS,
  ORDER_DAYS,
} from '../js/core/next-bean.js';
import { makeDemoData } from '../js/core/demo-data.js';

const at = (d) => `2026-11-${String(d).padStart(2, '0')}T00:00:00.000Z`;
let seq = 0;
function bean(o = {}) {
  const id = o.id ?? `b${++seq}`;
  return { id, name: o.name ?? id, roastLevel: 'シティ', process: 'ウォッシュト', origin: { country: 'ブラジル' }, status: 'finished', createdAt: at(1), deletedAt: null, ...o };
}
function cups(beanId, starsList) {
  const brews = [];
  const tastings = [];
  for (const s of starsList) {
    const id = `w${++seq}`;
    brews.push({ id, beanId, at: at(10), deletedAt: null, context: {}, planned: {}, actual: {} });
    if (s != null) tastings.push({ id: `t${id}`, brewId: id, by: 'me', stage: 'warm', stars: s, deletedAt: null, updatedAt: at(10) });
  }
  return { brews, tastings };
}
function data(beans, perBean, extra = {}) {
  const brews = [];
  const tastings = [];
  beans.forEach((b, i) => {
    const c = cups(b.id, perBean[i] ?? []);
    brews.push(...c.brews);
    tastings.push(...c.tastings);
  });
  return { beans, brews, tastings, experiments: [], wishlist: [], ...extra };
}
const wish = (o = {}) => ({ id: o.id ?? `wish${++seq}`, name: 'x', origin: { country: '' }, process: '', roastLevel: '', labelWeightG: 100, priceJpy: 800, priceTable: [], createdAt: at(15), deletedAt: null, ...o });

test('開拓ボーナス：飲んだことがなければ満点、5杯未満は半分、5杯からは0', () => {
  const counts = { origin: new Map([['ケニア', 3], ['ブラジル', 5]]), process: new Map([['ナチュラル', 1]]) };
  const none = exploreBonus({ country: 'エチオピア', process: 'アナエロビック' }, counts);
  assert.equal(none.pts, EXPLORE_BONUS.origin + EXPLORE_BONUS.process);
  assert.equal(none.parts[0].text, 'まだ飲んだことのない産地（エチオピア）');
  const few = exploreBonus({ country: 'ケニア', process: 'ナチュラル' }, counts);
  assert.equal(few.pts, (EXPLORE_BONUS.origin + EXPLORE_BONUS.process) / 2);
  assert.equal(few.parts[0].text, 'あまり飲んでいない産地（ケニア、3杯）');
  assert.equal(exploreBonus({ country: 'ブラジル', process: '' }, counts).pts, 0, '産地をよく飲んでいて精製がわからなければ0');
});

test('焙煎度の選び方：焙煎度比較 → 産地×焙煎度（3杯以上） → 前回・店の標準', () => {
  const heat = { cells: { ケニア: { シティ: { n: 2, score: 4.8 }, ハイ: { n: 3, score: 4.1 }, フルシティ: { n: 4, score: 3.9 } } } };
  const prefs = [{ key: 'c:ケニア', label: 'ケニア', experiments: 2, best: 'フルシティ' }];
  assert.deepEqual(recommendRoast({ country: 'ケニア', fallback: 'ミディアム', fallbackWhy: '店の標準' }, { prefs, heat }), {
    level: 'フルシティ',
    why: 'ケニアの焙煎度比較で好き・2回',
    source: 'compare',
  });
  const cell = recommendRoast({ country: 'ケニア', fallback: 'ミディアム', fallbackWhy: '店の標準' }, { prefs: [], heat });
  assert.equal(cell.level, 'ハイ', '2杯しかないシティは使わない');
  assert.equal(cell.why, 'ケニア×ハイの好みが★4.1・3杯');
  assert.equal(recommendRoast({ country: 'ペルー', fallback: 'ミディアム', fallbackWhy: '店の標準' }, { prefs, heat }).why, '店の標準');
  assert.equal(recommendRoast({ country: '', fallback: '' }, { prefs, heat }).source, 'none');
});

test('評価がひとつもなくても候補が出る（★3で予想、飲んだことのない産地に開拓の印）', () => {
  const list = nextBeanCandidates({ wishlist: [wish({ name: 'エチオピア', origin: { country: 'エチオピア' }, roastLevel: 'ミディアム' })] });
  assert.equal(list.length, 1);
  const c = list[0];
  assert.equal(c.source, 'wish');
  assert.equal(c.predicted, 3);
  assert.equal(c.badge, 'explore');
  assert.equal(c.roastLevel, 'ミディアム');
  assert.equal(c.roastWhy, '店の標準');
  assert.deepEqual(c.reasons, ['まだ評価がないので、★3で予想', 'まだ飲んだことのない産地（エチオピア）']);
  assert.deepEqual(nextBeanCandidates({}), []);
});

test('定番と開拓が混ざって並ぶ：よく飲んだ★の高い豆と、まだ飲んでいない産地の気になる豆', () => {
  const fav = bean({ name: 'ブラジル', origin: { country: 'ブラジル' } });
  const meh = bean({ name: 'コロンビア', origin: { country: 'コロンビア' } });
  const d = data([fav, meh], [[5, 5, 4, 5, 5, 4], [3, 2, 3, 3, 3]], {
    wishlist: [wish({ name: 'エチオピア G1', origin: { country: 'エチオピア' }, process: 'ナチュラル', roastLevel: 'ハイ' })],
  });
  const list = nextBeanCandidates(d);
  // まだ飲んでいない産地と精製は、全体の平均＋0.8で、いちばん好きな豆と並ぶくらいの点になる
  assert.deepEqual(list.map((c) => c.name), ['エチオピア G1', 'ブラジル', 'コロンビア']);
  const [e, b, c] = list;
  assert.equal(b.badge, 'steady');
  assert.equal(b.source, 'past');
  assert.equal(b.reasons[0], 'この豆の★平均 4.7（6杯）');
  assert.equal(b.bonus, 0);
  assert.equal(e.badge, 'explore');
  assert.equal(e.bonus, EXPLORE_BONUS.origin + EXPLORE_BONUS.process);
  assert.equal(e.reasons[0], '似た豆の記録がないので、全体の平均★3.8で予想');
  assert.equal(e.reasons[1], 'まだ飲んだことのない産地（エチオピア）');
  assert.ok(e.score - b.score < 0.3, '開拓の豆が大きく抜けすぎない');
  assert.ok(c.score < e.score);
  assert.ok(b.score > c.score);
});

test('杯数の少ない豆は全体の平均に寄る（1杯だけ★5の豆が、★4.6が8杯の豆を抜かない）', () => {
  const many = bean({ name: 'A', origin: { country: 'ブラジル' } });
  const one = bean({ name: 'B', origin: { country: 'ブラジル' } });
  const filler = bean({ name: 'C', origin: { country: 'ブラジル' } });
  const d = data([many, one, filler], [[5, 5, 5, 4, 5, 4, 5, 4], [5], [3, 3, 3, 3]]);
  const list = nextBeanCandidates(d);
  assert.equal(list[0].name, 'A');
  assert.equal(list[1].name, 'B');
});

test('買ったことのある豆は銘柄でまとめ、焙煎度は「この豆でいちばん★の高い焙煎度」、在庫と袋の数', () => {
  const b1 = bean({ name: 'ケニア AA', roastLevel: 'シティ', origin: { country: 'ケニア' }, createdAt: at(1), priceJpy: 900, labelWeightG: 100, labelWeightBasis: 'green' });
  const b2 = bean({ name: 'ケニアAA', roastLevel: 'ハイ', origin: { country: 'ケニア' }, createdAt: at(5), status: 'open', priceJpy: 950, labelWeightG: 100, labelWeightBasis: 'green' });
  const d = data([b1, b2], [[3, 3], [5, 4]]);
  const [c] = nextBeanCandidates(d);
  assert.equal(c.bags, 2);
  assert.equal(c.inStock, true);
  assert.equal(c.priceJpy, 950, '新しい袋の値段');
  // 産地×焙煎度は2杯ずつで足りないので、この豆の焙煎度の★を使う
  assert.equal(c.roastLevel, 'ハイ');
  assert.equal(c.roastWhy, 'この豆のハイが★4.5でいちばん');
  // 1つの焙煎度しか飲んでいなければ前回と同じ
  const [only] = nextBeanCandidates(data([bean({ name: 'Z', roastLevel: 'フレンチ' })], [[4]]));
  assert.equal(only.roastWhy, '前回と同じ');
});

test('気になる豆に、前に買った同じ銘柄があれば1つにまとめ、自分の★を使う。購入済みの気になる豆は出さない', () => {
  const b = bean({ name: 'ケニア AA', origin: { country: 'ケニア' }, createdAt: at(1) });
  const w = wish({ name: 'ケニア AA', origin: { country: 'ケニア' }, priceJpy: 1000, createdAt: at(15) });
  const bought = wish({ name: '買った豆', createdAt: at(15), boughtBeanId: 'bx' });
  const bx = bean({ id: 'bx', name: '買った豆', createdAt: at(16) });
  const list = nextBeanCandidates(data([b, bx], [[4, 4, 5], []], { wishlist: [w, bought] }));
  const kenya = list.filter((c) => c.name === 'ケニア AA');
  assert.equal(kenya.length, 1);
  assert.equal(kenya[0].source, 'wish');
  assert.equal(kenya[0].rated, 3);
  assert.equal(kenya[0].priceJpy, 1000, '気になる豆の値段を使う');
  assert.equal(list.filter((c) => c.wishId === bought.id).length, 0);
  assert.equal(list.filter((c) => c.name === '買った豆').length, 1, '買った豆はこれまでに買った豆として出る');
});

test('焙煎度比較の結果があれば、気になる豆の焙煎度もそれにする', () => {
  const m = bean({ id: 'm', name: 'エチオピア M', roastLevel: 'ミディアム', origin: { country: 'エチオピア' }, status: 'open' });
  const h = bean({ id: 'h', name: 'エチオピア H', roastLevel: 'ハイ', origin: { country: 'エチオピア' }, status: 'open' });
  const exp = {
    id: 'e1',
    kind: 'roast',
    entries: [{ beanId: 'm', brewId: null }, { beanId: 'h', brewId: null }],
    ratings: [{ beanId: 'm', stars: 3 }, { beanId: 'h', stars: 5 }],
    revealedAt: at(12),
    deletedAt: null,
  };
  const w = wish({ name: 'エチオピア 新しい豆', origin: { country: 'エチオピア' }, roastLevel: 'ミディアム' });
  const list = nextBeanCandidates({ beans: [m, h], brews: [], tastings: [], experiments: [exp], wishlist: [w] });
  const c = list.find((x) => x.wishId === w.id);
  assert.equal(c.roastLevel, 'ハイ');
  assert.match(c.roastWhy, /焙煎度比較で好き/);
});

test('消した豆・杯は数えない', () => {
  const b = bean({ name: 'A', deletedAt: at(3) });
  assert.deepEqual(nextBeanCandidates(data([b], [[5]])), []);
});

test('注文の量：ペースの4週間分を種類で分け、生豆時100g単位に切り上げる', () => {
  const picked = [
    { key: 'a', roastLevel: 'シティ', labelWeightG: 100, labelWeightBasis: 'green' },
    { key: 'b', roastLevel: 'ミディアム', labelWeightG: 200, labelWeightBasis: 'green' },
  ];
  const plan = { gPerDay: 15 };
  const r = orderGrams({ picked, plan });
  // 15g×28日＝420g（焙煎後）÷2＝210g → 生豆時は目減りの分だけ多く → 300g
  assert.equal(r.basis, 'pace');
  assert.equal(r.days, ORDER_DAYS);
  assert.equal(r.grams.get('a'), 300);
  assert.equal(r.grams.get('b'), 300);
  // 冷凍庫の空きが少なければ減らす：14日分（210g）＋2袋×15g＝240g ÷2＝120g → 200g
  const t = orderGrams({ picked, plan, freeSlots: 2, doseG: 15 });
  assert.equal(t.trimmed, true);
  assert.equal(t.days, 16);
  assert.equal(t.grams.get('a'), 200);
  // ペースがわからなければ表記重量（なければ100g）
  const l = orderGrams({ picked: [...picked, { key: 'c', labelWeightBasis: 'roasted', labelWeightG: 250 }], plan: {} });
  assert.equal(l.basis, 'label');
  assert.deepEqual([...l.grams.values()], [100, 200, 100]);
  assert.equal(orderGrams({ picked: [{ key: 'x', roastLevel: 'シティ' }], plan: { gPerDay: 1 } }).grams.get('x'), 100, '少なくても100g');
});

test('量の値段：価格表 → 表記の値段から比例（約） → わからない', () => {
  assert.deepEqual(priceForGrams({ priceTable: [{ g: 300, priceJpy: 1740 }] }, 300), { priceJpy: 1740, estimated: false });
  assert.deepEqual(priceForGrams({ priceJpy: 720, labelWeightG: 100, labelWeightBasis: 'green' }, 300), { priceJpy: 2160, estimated: true });
  assert.deepEqual(priceForGrams({ priceJpy: 720, labelWeightG: 100, labelWeightBasis: 'green' }, 100), { priceJpy: 720, estimated: false });
  assert.equal(priceForGrams({ priceJpy: 720, labelWeightG: 200, labelWeightBasis: 'roasted' }, 300), null);
});

test('注文メモ：いつまでに・何を・焙煎度・何g・値段', () => {
  const picked = [
    { key: 'a', name: 'ブラジル', roastLevel: 'シティ', avgStars: 4.7, badge: 'steady', priceTable: [{ g: 300, priceJpy: 1740 }] },
    { key: 'b', name: 'エチオピア G1', roastLevel: 'ハイ', avgStars: null, badge: 'explore', priceJpy: 800, labelWeightG: 100, labelWeightBasis: 'green', priceTable: [] },
  ];
  const plan = { status: 'soon', orderByYmd: '2026-11-21' };
  const amounts = { grams: new Map([['a', 300], ['b', 300]]), basis: 'pace', days: 28, trimmed: false };
  assert.equal(
    nextBeanMemo(picked, plan, amounts),
    [
      '珈琲問屋 注文メモ（11/21までに）',
      '・ブラジル シティロースト 生豆時300g 1,740円（前回 ★4.7）',
      '・エチオピア G1 ハイロースト 生豆時300g 約2,400円（初めて）',
      '量は飲むペースの28日分を2種で分けた目安',
    ].join('\n'),
  );
  assert.equal(nextBeanMemo(picked.slice(0, 1), { status: 'unknown' }, { grams: new Map(), basis: 'label' }), '珈琲問屋 注文メモ\n・ブラジル シティロースト（前回 ★4.7）');
});

test('デモのデータで、候補がそろい、undefined や NaN が出ない', () => {
  const d = makeDemoData(new Date('2026-11-18T09:00:00+09:00'));
  const list = nextBeanCandidates(d);
  assert.ok(list.length >= 3);
  for (const c of list) {
    assert.ok(Number.isFinite(c.score), c.name);
    assert.doesNotMatch([c.name, c.roastLevel, c.roastWhy, ...c.reasons].join(' '), /undefined|NaN|null/);
  }
});
