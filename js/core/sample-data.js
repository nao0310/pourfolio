// 確認用のサンプルデータ（純粋関数）。全部の表に、つながった記録を入れる。
// テストと、データ画面の「サンプルを入れる」（開発用）で使う。値は説明用の例。

import { createRecord, SETTINGS_ID } from './records.js';

/**
 * @param {Date|string|number} [now]
 * @returns {Record<string, object[]>}
 */
/** サンプルの写真（1×1の画像） */
const SAMPLE_PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export function makeSampleData(now = new Date()) {
  const base = now instanceof Date ? now : new Date(now);
  const daysAgo = (d) => new Date(base.getTime() - d * 86400000);
  const ymd = (d) => daysAgo(d).toISOString().slice(0, 10);

  // 珈琲問屋への注文（サンプルの豆はこの注文で届いた）
  const order = createRecord(
    {
      shop: '珈琲問屋',
      orderNo: 'SAMPLE-0001',
      orderDate: ymd(14),
      shippingJpy: 500,
      items: [{ name: 'サンプル エチオピア', roastLevel: 'シティ', labelWeightG: 200, qty: 1, priceJpy: 1200 }],
    },
    daysAgo(14),
  );

  const bean = createRecord(
    {
      orderId: order.id,
      orderDate: ymd(14),
      arrivalDate: ymd(9),
      name: 'サンプル エチオピア',
      shop: '珈琲問屋',
      productUrl: '',
      origin: { country: 'エチオピア', region: 'イルガチェフェ' },
      variety: '在来種',
      process: 'ウォッシュト',
      roastLevel: 'シティ',
      roastDate: ymd(10),
      labelWeightG: 200,
      labelWeightBasis: 'green', // green=生豆時 / roasted=焙煎後
      actualWeightG: 166.5,
      priceJpy: 1200,
      status: 'open',
      memo: '確認用のサンプル',
    },
    daysAgo(9),
  );

  const dripper = createRecord({ kind: 'dripper', name: 'サンプル 円錐ドリッパー', attrs: { shape: 'cone', holes: 1 } }, daysAgo(9));
  const grinder = createRecord(
    { kind: 'grinder', name: 'サンプル 手挽きミル', attrs: { burr: 'conical', step: 1, zeroPoint: 0 } },
    daysAgo(9),
  );

  const recipe = createRecord(
    {
      name: '4:6メソッド（サンプル）',
      version: 1,
      parentId: null,
      doseG: 20,
      waterG: 300,
      tempC: 92,
      grind: { grinderId: grinder.id, setting: '24' },
      bloom: { waterG: 60, sec: 45, stir: false },
      pours: [
        { atSec: 0, toG: 60 },
        { atSec: 45, toG: 120 },
        { atSec: 90, toG: 180 },
        { atSec: 130, toG: 240 },
        { atSec: 170, toG: 300 },
      ],
      targetTotalSec: 210,
    },
    daysAgo(9),
  );

  const brew = createRecord(
    {
      at: daysAgo(1).toISOString(),
      beanId: bean.id,
      recipeId: recipe.id,
      equipment: { dripperId: dripper.id, grinderId: grinder.id },
      planned: { doseG: 20, waterG: 300, tempC: 92, grind: '24' },
      actual: {
        doseG: 20.1,
        waterG: 302,
        tempC: 92,
        grind: { grinderId: grinder.id, setting: '24' },
        pours: [
          { atSec: 0, toG: 60 },
          { atSec: 45, toG: 120 },
          { atSec: 90, toG: 180 },
          { atSec: 130, toG: 240 },
          { atSec: 170, toG: 302 },
        ],
        totalSec: 215,
        beverageG: 260,
        tdsPct: null,
      },
      beanState: 'roomTemp',
      context: { mood: 'focus', purpose: 'morning' },
      memo: '',
    },
    daysAgo(1),
  );

  const tasting = createRecord(
    {
      brewId: brew.id,
      by: 'me',
      stage: 'warm',
      stars: 4,
      tags: ['酸っぱい'],
      jar: { strength: 0, acidity: 1, bitterness: 0, sweetness: -1, body: 0, astringency: 0 },
      memo: '冷めると甘さが出る',
    },
    daysAgo(1),
  );

  const suggestion = createRecord(
    {
      kind: 'dialin',
      brewId: brew.id,
      tastingId: tasting.id,
      beanId: bean.id,
      recipeId: recipe.id,
      cell: { strength: 'ok', extraction: 'under' },
      cellName: '酸っぱい・余韻が短い',
      action: { kind: 'finer', variable: 'grind', from: '24', to: '23', unit: '', text: '挽き目を1目盛り細かく：挽き目 24 → 23', short: '挽き目 24 → 23' },
      nextStep: null,
      alt: 'または湯温を2℃上げる',
      reasons: {
        input: ['濃さ ちょうど', '酸味 やや強い', '苦味 ちょうど', '渋み ちょうど'],
        theory: '濃さ「ちょうど」×抽出「抽出が足りない」のマス（酸っぱい・余韻が短い）。1杯で変えるのは1つだけ',
        history: 'まだ実績はありません。提案どおりに淹れて評価すると表示します',
        confidence: { level: 'mid', text: 'ちょうど良さで濃さと抽出の両方に答えている。実績はまだ少ない' },
      },
      confidence: 'mid',
      jarBefore: { ...tasting.jar },
      tagsBefore: [...tasting.tags],
      adopted: null,
      nextBrewId: null,
    },
    daysAgo(1),
  );

  const inventoryTx = [
    createRecord({ beanId: bean.id, at: daysAgo(9).toISOString(), deltaG: 166.5, kind: 'in', brewId: null, memo: '' }, daysAgo(9)),
    createRecord({ beanId: bean.id, at: brew.at, deltaG: -20.1, kind: 'brew', brewId: brew.id, memo: '' }, daysAgo(1)),
  ];
  // 冷凍の小分け（C4）：2袋を冷凍した
  const freezeTx = createRecord(
    { beanId: bean.id, at: daysAgo(5).toISOString(), deltaG: -30, kind: 'freeze', brewId: null, memo: '#1・#2（15g×2袋）' },
    daysAgo(5),
  );
  inventoryTx.push(freezeTx);
  const frozenPortions = [1, 2].map((labelNo) =>
    createRecord(
      { beanId: bean.id, labelNo, grams: 15, frozenDate: ymd(5), roastDaysAtFreeze: 5, freezeTxId: freezeTx.id, takenOutAt: null, takenOutBrewId: null },
      daysAgo(5),
    ),
  );

  // 写真（A7）：抽出液の写真1枚（1×1の小さな画像）
  const photo = createRecord(
    { brewId: brew.id, slot: 'liquid', dataUrl: SAMPLE_PHOTO, widthPx: 1, heightPx: 1, bytes: 70 },
    daysAgo(1),
  );

  // 焙煎度比較（X27）：始めたばかりの飲み比べ（まだ淹れていない）
  const experiment = createRecord(
    {
      kind: 'roast',
      title: `${bean.name} 焙煎度比較`,
      blind: true,
      recipeId: recipe.id,
      entries: [{ beanId: bean.id, brewId: null }],
      ratings: [],
      revealedAt: null,
    },
    daysAgo(1),
  );

  // 気になる豆（F6）：まだ買っていない候補1つ
  const wish = createRecord(
    {
      name: 'ケニア ニエリ AA',
      productUrl: '',
      productCode: '',
      origin: { country: 'ケニア', region: 'ニエリ', farm: '' },
      variety: '',
      process: 'ウォッシュト',
      roastLevel: 'シティ',
      labelWeightG: 100,
      labelWeightBasis: 'green',
      priceJpy: 900,
      priceTable: [],
      flavorNotes: '',
      memo: '',
      boughtBeanId: null,
    },
    daysAgo(2),
  );

  // お店で飲んだ1杯（X37、分析には入れない）
  const cafeVisit = createRecord(
    {
      at: daysAgo(3).toISOString(),
      shopName: 'サンプル珈琲店',
      drinkName: 'ケニア ハンドドリップ',
      method: 'drip',
      temp: 'hot',
      beanName: 'ケニア',
      roastLevel: 'シティ',
      priceJpy: 650,
      stars: 4,
      memo: '',
    },
    daysAgo(3),
  );

  const settings = createRecord({ id: SETTINGS_ID, lastBackupAt: null }, daysAgo(9));

  return {
    beans: [bean],
    inventoryTx,
    equipment: [dripper, grinder],
    recipes: [recipe],
    brews: [brew],
    tastings: [tasting],
    suggestions: [suggestion],
    orders: [order],
    frozenPortions,
    photos: [photo],
    experiments: [experiment],
    wishlist: [wish],
    cafeVisits: [cafeVisit],
    settings: [settings],
  };
}
