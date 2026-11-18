// 確認用のサンプルデータ（純粋関数）。全部の表に、つながった記録を入れる。
// テストと、データ画面の「サンプルを入れる」（開発用）で使う。値は説明用の例。

import { createRecord, SETTINGS_ID } from './records.js';

/**
 * @param {Date|string|number} [now]
 * @returns {Record<string, object[]>}
 */
export function makeSampleData(now = new Date()) {
  const base = now instanceof Date ? now : new Date(now);
  const daysAgo = (d) => new Date(base.getTime() - d * 86400000);
  const ymd = (d) => daysAgo(d).toISOString().slice(0, 10);

  const bean = createRecord(
    {
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

  const inventoryTx = [
    createRecord({ beanId: bean.id, at: daysAgo(9).toISOString(), deltaG: 166.5, kind: 'in', brewId: null, memo: '' }, daysAgo(9)),
    createRecord({ beanId: bean.id, at: brew.at, deltaG: -20.1, kind: 'brew', brewId: brew.id, memo: '' }, daysAgo(1)),
  ];

  const settings = createRecord({ id: SETTINGS_ID, lastBackupAt: null }, daysAgo(9));

  return {
    beans: [bean],
    inventoryTx,
    equipment: [dripper, grinder],
    recipes: [recipe],
    brews: [brew],
    tastings: [tasting],
    settings: [settings],
  };
}
