// 珈琲問屋の商品ページ（X28）と注文確認メール（X29）の読み取り
// 見本は実際の文章を元に、注文番号・日時・個人の情報・他のお客様のレビューを架空のものに置き換えたもの
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseProductText, parseOrderEmail, normalizeProcess, roastFromText, productMemo } from '../js/core/tonya.js';
import { normalizeOrderItem } from '../js/core/orders.js';
import { normalizeBeanInput } from '../js/core/beans.js';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('焙煎度の書き方から8段階の表記を取り出す（フルシティをシティと読まない）', () => {
  assert.equal(roastFromText('ミディアム(標準)'), 'ミディアム');
  assert.equal(roastFromText('ハイ(+20秒)'), 'ハイ');
  assert.equal(roastFromText('フルシティ(+60秒)'), 'フルシティ');
  assert.equal(roastFromText('シティ(+40秒)'), 'シティ');
  assert.equal(roastFromText('ミディアムロースト'), 'ミディアム');
  assert.equal(roastFromText('生豆（焼かない）'), '');
});

test('精製方法の書き方をそろえる', () => {
  assert.equal(normalizeProcess('ウォッシュド'), 'ウォッシュト');
  assert.equal(normalizeProcess('フルウォッシュト'), 'ウォッシュト');
  assert.equal(normalizeProcess('ナチュラル（非水洗式）'), 'ナチュラル');
  assert.equal(normalizeProcess('パルプドナチュラル'), 'ハニー');
  assert.equal(normalizeProcess('スマトラ式'), 'スマトラ式');
  assert.equal(normalizeProcess('アナエロビック・ナチュラル'), 'アナエロビック');
  assert.equal(normalizeProcess('カーボニックマセレーション'), 'カーボニックマセレーション', '知らない書き方はそのまま');
  assert.equal(normalizeProcess(''), '');
});

test('商品ページ：銘柄・産地・精製・規格・店の標準の焙煎度・100gの価格と価格表', async () => {
  const p = parseProductText(await fixture('tonya-product.txt'));
  assert.equal(p.found, true);
  assert.equal(p.name, 'ガテマラSHB');
  assert.equal(p.productCode, '2');
  assert.equal(p.country, 'グアテマラ');
  assert.equal(p.region, '', '産地が生産国と同じなら地域には入れない');
  assert.equal(p.process, 'ウォッシュト');
  assert.equal(p.grade, 'SHB');
  assert.equal(p.roastLevel, 'ミディアム', 'レビューの「シティ」ではなく店の標準');
  assert.equal(p.labelWeightG, 100);
  assert.equal(p.labelWeightBasis, 'green');
  assert.equal(p.priceJpy, 720);
  assert.deepEqual(p.priceTable, [
    { g: 100, priceJpy: 720 },
    { g: 200, priceJpy: 1280 },
    { g: 300, priceJpy: 1740 },
    { g: 400, priceJpy: 2040 },
    { g: 500, priceJpy: 2250 },
  ]);
  assert.equal(p.flavorNotes, '豊かな香り、コク、酸味と三拍子揃った味わい。');
  assert.equal(productMemo(p), '規格：SHB');
});

test('商品ページ：レビューの中の「産地：」は拾わない', async () => {
  const text = await fixture('tonya-product.txt');
  assert.ok(text.includes('産地：エチオピア'), '見本のレビューに紛らわしい行がある');
  assert.equal(parseProductText(text).country, 'グアテマラ');
  // 商品情報の表がないときも、レビューより前だけで読める
  const cut = text.slice(0, text.indexOf('もっと見る'));
  const p = parseProductText(cut);
  assert.equal(p.name, 'ガテマラSHB');
  assert.equal(p.country, 'グアテマラ');
});

test('商品ページ：地域・農園・品種・標高がある豆', () => {
  const text = [
    'ホーム > コーヒー > 特別なコーヒー',
    'エチオピア イルガチェフェ G1 コンガ農協',
    '商品コード：12345',
    '掲載日：2025/04/01',
    'ジャスミンのような華やかな香り。',
    '(生豆時100gあたり)',
    '1,080円(税込)',
    '生産国：エチオピア',
    '地域：イルガチェフェ',
    '農園：コンガ農協',
    '品種：エチオピア原種',
    '精製方法：ナチュラル',
    '標高：1,900〜2,100m',
  ].join('\n');
  const p = parseProductText(text);
  assert.equal(p.name, 'エチオピア イルガチェフェ G1 コンガ農協');
  assert.equal(p.region, 'イルガチェフェ');
  assert.equal(p.farm, 'コンガ農協');
  assert.equal(p.variety, 'エチオピア原種');
  assert.equal(p.process, 'ナチュラル');
  assert.equal(p.priceJpy, 1080);
  assert.deepEqual(p.priceTable, [], '価格表がなければ100gの価格だけ');
  assert.equal(p.roastLevel, '', '店の標準が書いてなければ空');
  assert.equal(productMemo(p), '標高：1,900〜2,100m');
});

test('商品ページ：関係ない文章や空では何も入れない', () => {
  for (const t of ['', 'こんにちは\n今日はいい天気です', 'ホーム > コーヒー\n']) {
    const p = parseProductText(t);
    assert.equal(p.found, false, JSON.stringify(t));
    assert.equal(p.name, '');
  }
});

test('商品ページの結果は、そのまま豆の入力として保存できる', async () => {
  const p = parseProductText(await fixture('tonya-product.txt'));
  const { errors, value } = normalizeBeanInput({
    name: p.name,
    country: p.country,
    process: p.process,
    roastLevel: p.roastLevel,
    labelWeightG: String(p.labelWeightG),
    labelWeightBasis: p.labelWeightBasis,
    priceJpy: String(p.priceJpy),
    flavorNotes: p.flavorNotes,
  });
  assert.deepEqual(errors, {});
  assert.equal(value.process, 'ウォッシュト');
});

test('注文メール：注文番号・注文日・送料と、3つの品目', async () => {
  const o = parseOrderEmail(await fixture('tonya-order.txt'));
  assert.equal(o.found, true);
  assert.equal(o.orderNo, '9990001');
  assert.equal(o.orderDate, '2026-11-01');
  assert.equal(o.shippingJpy, 0);
  assert.deepEqual(o.others, []);
  assert.deepEqual(o.items, [
    {
      name: 'ラオス ミンティエン農園 ウォッシュド',
      productCode: '20564',
      roastLevel: 'ミディアム',
      isGreen: false,
      labelWeightG: 300,
      labelWeightBasis: 'green',
      qty: 1,
      priceJpy: 1620,
      process: 'ウォッシュト',
      farm: 'ミンティエン農園',
    },
    { name: 'ガテマラSHB', productCode: '2', roastLevel: 'ミディアム', isGreen: false, labelWeightG: 100, labelWeightBasis: 'green', qty: 1, priceJpy: 720, process: '', farm: '' },
    { name: 'マンデリンG1', productCode: '11', roastLevel: 'ハイ', isGreen: false, labelWeightG: 200, labelWeightBasis: 'green', qty: 1, priceJpy: 1280, process: '', farm: '' },
  ]);
  // 読み取った品目は、そのまま注文の品目として確かめられる
  for (const it of o.items) assert.deepEqual(normalizeOrderItem(it).errors, {});
});

test('注文メール：名前・住所・電話番号は読まない', async () => {
  const o = parseOrderEmail(await fixture('tonya-order.txt'));
  const json = JSON.stringify(o);
  for (const word of ['○○', '〒', 'TEL', 'クレジット', 'ゆうパック']) assert.ok(!json.includes(word), word);
});

test('注文メール：数量2、豆以外の品物、生豆、焙煎後の表記、送料あり', () => {
  const text = [
    '[注文番号]     1000002',
    '[ご注文日時]   2026/12/05 20:15:00',
    '[商品]',
    '(5-200)ブラジル ショコラ（200g　（生豆時））',
    '焙煎度合:フルシティ(+60秒)',
    '価格  1,180(円) x 2(個) = 2,360(円)  (税込)',
    '----------',
    '(900-1)西八製菓 コーヒー糖 （９個入）',
    '価格  389(円) x 1(個) = 389(円)  (税込)',
    '----------',
    '(7-100)コロンビア スプレモ（100g　（生豆時））',
    '焙煎度合:生豆（焼かない）',
    '価格  650(円) x 1(個) = 650(円)  (税込)',
    '----------',
    '(8-250)ハウスブレンド（250g　（焙煎後））',
    '焙煎度合:シティ(+40秒)',
    '価格  1,500(円) x 1(個) = 1,500(円)  (税込)',
    '',
    '小計         : 4,899(円)',
    '送料         : 330(円)',
  ].join('\n');
  const o = parseOrderEmail(text);
  assert.equal(o.orderDate, '2026-12-05');
  assert.equal(o.shippingJpy, 330);
  assert.deepEqual(o.items.map((i) => [i.name, i.roastLevel, i.qty, i.labelWeightG, i.labelWeightBasis, i.isGreen]), [
    ['ブラジル ショコラ', 'フルシティ', 2, 200, 'green', false],
    ['コロンビア スプレモ', '', 1, 100, 'green', true],
    ['ハウスブレンド', 'シティ', 1, 250, 'roasted', false],
  ]);
  assert.deepEqual(o.others, [{ name: '西八製菓 コーヒー糖 (9個入)', qty: 1, priceJpy: 389 }]);
});

test('注文メール：関係ない文章では見つからない（止まらない）', () => {
  for (const t of ['', 'ご注文ありがとうございます。', '[商品]\nよく分からない行\n小計 : 0(円)']) {
    const o = parseOrderEmail(t);
    assert.equal(o.found, false, JSON.stringify(t));
    assert.deepEqual(o.items, []);
  }
});
