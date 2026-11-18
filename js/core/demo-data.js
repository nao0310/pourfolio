// 分析のデモデータ（純粋関数）。豆8袋・約80杯・TDS付き約30杯の、つながった記録を作る。
// 分析の画面の「デモで見る」（端末のデータには書かない、D-117）と、データの画面の「デモデータを入れる」（開発用）で使う。
// 器具は「いつも使う」にしない（入れても自分の器具の初期値を変えない）。
// 値は説明用の作り話。乱数は種を固定し、同じ日に作れば同じ中身になる（IDだけは毎回変わる）。

import { createRecord } from './records.js';
import { ratioOf } from './recipes.js';
import { localYmd } from './format.js';
import { daysBetween } from './freshness.js';

/** 種を固定した乱数（mulberry32） */
export function seededRandom(seed = 20261118) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** デモの豆（古い順）。base は好みの強さ、opt はちょうど良い挽き目（C40の目盛り） */
const BAGS = [
  { name: 'デモ ケニア ニエリ', country: 'ケニア', region: 'ニエリ', process: 'ウォッシュト', variety: 'SL28', roastLevel: 'ハイ', base: 4.3, opt: 22, flav: ['fruity/blackberry', 'fruity/grapefruit'] },
  { name: 'デモ エチオピア グジ', country: 'エチオピア', region: 'グジ', process: 'ナチュラル', variety: '在来種', roastLevel: 'シティ', base: 4.0, opt: 23, flav: ['fruity/blueberry', 'floral/jasmine'] },
  { name: 'デモ グアテマラ アンティグア', country: 'グアテマラ', region: 'アンティグア', process: 'ウォッシュト', variety: 'ブルボン', roastLevel: 'シティ', base: 3.6, opt: 24, flav: ['fruity/orange'] },
  { name: 'デモ ブラジル セラード', country: 'ブラジル', region: 'セラード', process: 'パルプドナチュラル', variety: 'ムンドノーボ', roastLevel: 'フルシティ', base: 3.2, opt: 25, flav: [] },
  { name: 'デモ コロンビア ウィラ', country: 'コロンビア', region: 'ウィラ', process: 'ウォッシュト', variety: 'カツーラ', roastLevel: 'シティ', base: 3.8, opt: 23, flav: ['fruity/cherry'] },
  { name: 'デモ エチオピア イルガチェフェ', country: 'エチオピア', region: 'イルガチェフェ', process: 'ウォッシュト', variety: '在来種', roastLevel: 'シティ', base: 4.1, opt: 22, flav: ['floral/jasmine', 'fruity/lemon'] },
  { name: 'デモ マンデリン', country: 'インドネシア', region: 'スマトラ', process: 'スマトラ式', variety: 'ティピカ', roastLevel: 'フレンチ', base: 3.0, opt: 26, flav: [] },
  { name: 'デモ ケニア キリニャガ', country: 'ケニア', region: 'キリニャガ', process: 'ウォッシュト', variety: 'SL34', roastLevel: 'シティ', base: 4.2, opt: 22, flav: ['fruity/raspberry'] },
];

/** 詳細評価の項目ごとの、好みがいちばん高い強さ（デモの「味の好みの位置」） */
const LIKING_PEAK = { fragrance: 10, aroma: 10, flavor: 9, aftertaste: 8, acidity: 8, sweetness: 11, mouthfeel: 7 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {Date|string|number} [now]
 * @returns {Record<string, object[]>} 全部の表（使わない表は空）
 */
export function makeDemoData(now = new Date()) {
  const base = now instanceof Date ? now : new Date(now);
  const rnd = seededRandom(Number(localYmd(base).replaceAll('-', '')));
  const at = (daysAgo, h, m) => {
    const d = new Date(base);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const first = at(95, 9, 0);

  // 器具と水（D1・D2・D3）
  const dripper = createRecord({ kind: 'dripper', name: 'デモ V60 02', attrs: { shape: 'cone', holes: 1, material: '樹脂' }, isDefault: false, memo: '' }, first);
  const filter = createRecord({ kind: 'filter', name: 'デモ V60用 無漂白', attrs: { material: 'paper', bleach: 'unbleached' }, isDefault: false, memo: '' }, first);
  const grinder = createRecord(
    { kind: 'grinder', name: 'デモ 手挽きミル', attrs: { burr: 'conical', step: 1, zeroPoint: '0', scale: [{ setting: 15, um: 450 }, { setting: 25, um: 750 }, { setting: 35, um: 1050 }] }, isDefault: false, memo: '' },
    first,
  );
  const grinder2 = createRecord(
    { kind: 'grinder', name: 'デモ 電動ミル', attrs: { burr: 'flat', step: 0.5, zeroPoint: '', scale: [{ setting: 2, um: 400 }, { setting: 6, um: 1200 }] }, isDefault: false, memo: '' },
    first,
  );
  const kettle = createRecord({ kind: 'kettle', name: 'デモ 細口ケトル', attrs: {}, isDefault: false, memo: '' }, first);
  const water = createRecord(
    { kind: 'water', name: 'デモ 水道水＋浄水器', attrs: { tdsMgL: 90, hardnessMgL: 55, alkalinityMgL: 35, ph: 7.3, sodiumMgL: 9 }, isDefault: false, memo: '' },
    first,
  );
  const equipment = [dripper, filter, grinder, grinder2, kettle, water];

  const recipe = createRecord(
    {
      name: 'デモ いつもの15g',
      version: 1,
      parentId: null,
      doseG: 15,
      waterG: 240,
      tempC: 92,
      grind: { grinderId: grinder.id, setting: '24' },
      bloom: { waterG: 40, sec: 40, stir: false },
      pours: [
        { atSec: 0, toG: 40 },
        { atSec: 40, toG: 120 },
        { atSec: 80, toG: 180 },
        { atSec: 115, toG: 240 },
      ],
      targetTotalSec: 180,
      equipment: { dripperId: dripper.id, filterId: filter.id, kettleId: kettle.id },
      favorite: true,
    },
    first,
  );

  // 抽出の日程：昨日からさかのぼって1日0〜2杯、全部で80杯。袋は古い順に10杯ずつ使う
  const slots = [];
  for (let d = 1; slots.length < BAGS.length * 10; d++) {
    const x = rnd();
    const cups = x < 0.12 ? 0 : x < 0.88 ? 1 : 2;
    if (cups >= 2) slots.push(at(d, 14, Math.floor(rnd() * 50)));
    if (cups >= 1 && slots.length < BAGS.length * 10) slots.push(at(d, 7, Math.floor(rnd() * 50)));
  }
  slots.sort((a, b) => a - b);

  const beans = [];
  const brews = [];
  const tastings = [];
  const suggestions = [];
  const inventoryTx = [];

  BAGS.forEach((bag, k) => {
    const cupsAt = slots.slice(k * 10, k * 10 + 10);
    if (!cupsAt.length) return;
    const restDays = 6 + Math.floor(rnd() * 5);
    const roast = new Date(cupsAt[0]);
    roast.setDate(roast.getDate() - restDays);
    const roastDate = localYmd(roast);
    const arrival = new Date(roast);
    arrival.setDate(arrival.getDate() + 2);
    const isLast = k >= BAGS.length - 2;
    const bean = createRecord(
      {
        orderId: null,
        orderDate: localYmd(new Date(roast.getTime() - 86400000)),
        arrivalDate: localYmd(arrival),
        name: bag.name,
        shop: '珈琲問屋',
        productUrl: '',
        origin: { country: bag.country, region: bag.region },
        variety: bag.variety,
        process: bag.process,
        roastLevel: bag.roastLevel,
        roastDate,
        labelWeightG: 200,
        labelWeightBasis: 'green',
        actualWeightG: 166,
        priceJpy: 1100 + Math.round(rnd() * 6) * 100,
        status: isLast ? 'open' : 'finished',
        memo: 'デモデータ',
      },
      arrival,
    );
    beans.push(bean);
    inventoryTx.push(createRecord({ beanId: bean.id, at: arrival.toISOString(), deltaG: 166, kind: 'in', brewId: null, memo: '' }, arrival));

    let g = bag.opt + (rnd() < 0.6 ? 2 : -2); // 新しい豆は少し外れた挽き目から始める
    let prevBrew = null;
    let prevTasting = null;
    cupsAt.forEach((when, i) => {
      const tempC = rnd() < 0.2 ? (rnd() < 0.5 ? 90 : 94) : 92;
      const ratio = [15, 15, 15.5, 16, 16, 16.5][Math.floor(rnd() * 6)];
      const doseG = 15;
      const waterG = Math.round(doseG * ratio);
      const days = daysBetween(roastDate, localYmd(when));
      const rest = days < 5 ? -0.7 : days <= 14 ? 0.2 : days > 25 ? -0.4 : 0;
      const q = bag.base - 0.45 * Math.abs(g - bag.opt) - 0.5 * Math.abs(ratio - 15.8) + rest + (rnd() - 0.5) * 0.9;
      const stars = clamp(Math.round(q), 1, 5);
      const ey = 19.5 + (bag.opt - g) * 0.9 + (tempC - 92) * 0.15 + (rnd() - 0.5);
      const measured = rnd() < 0.4;
      const bev = Math.round(waterG - (2.1 + (rnd() - 0.5) * 0.3) * doseG);
      const hasTds = rnd() < 0.38;
      const tds = hasTds ? r2((ey * doseG) / bev) : null;
      const brewAt = when.toISOString();

      // 前の杯の提案（挽き目）を使ったことにする
      let suggestionId = null;
      if (prevBrew && prevBrew.actual.grind.setting !== String(g)) {
        const from = prevBrew.actual.grind.setting;
        const finer = g < Number(from);
        const s = createRecord(
          {
            kind: 'dialin',
            brewId: prevBrew.id,
            tastingId: prevTasting?.id ?? null,
            beanId: bean.id,
            recipeId: recipe.id,
            cell: { strength: 'ok', extraction: finer ? 'under' : 'over' },
            cellName: finer ? '酸っぱい・余韻が短い' : '渋い・ドライ・えぐい',
            action: { kind: finer ? 'finer' : 'coarser', variable: 'grind', from, to: String(g), unit: '', text: `挽き目を1目盛り${finer ? '細かく' : '粗く'}：挽き目 ${from} → ${g}`, short: `挽き目 ${from} → ${g}` },
            nextStep: null,
            alt: '',
            reasons: { input: [], theory: 'デモ', history: '', confidence: { level: 'mid', text: 'デモ' } },
            confidence: 'mid',
            jarBefore: prevTasting?.jar ?? null,
            tagsBefore: prevTasting?.tags ?? [],
            adopted: true,
            nextBrewId: null,
          },
          prevBrew.at,
        );
        suggestions.push(s);
        suggestionId = s.id;
      }

      const brew = createRecord(
        {
          at: brewAt,
          beanId: bean.id,
          recipeId: recipe.id,
          recipeVersion: 1,
          suggestionId,
          experimentId: null,
          frozenPortionId: null,
          equipment: { dripperId: dripper.id, filterId: filter.id, kettleId: kettle.id, grinderId: grinder.id, waterId: water.id },
          planned: { name: recipe.name, doseG, waterG, tempC, grind: { grinderId: grinder.id, setting: String(g) }, pours: recipe.pours, targetTotalSec: 180 },
          actual: {
            doseG,
            waterG,
            tempC,
            grind: { grinderId: grinder.id, setting: String(g) },
            pours: recipe.pours.map((p) => ({ ...p, doneSec: p.atSec + 8 + Math.round(rnd() * 6) })),
            totalSec: Math.round(180 + (bag.opt - g) * 8 + (rnd() - 0.5) * 20),
            beverageG: measured ? bev : null,
            tdsPct: tds,
          },
          timerUsed: true,
          precheck: null,
          beanState: null,
          context: {},
          derived: { ratio: ratioOf(doseG, waterG), daysOffRoast: days, diff: {} },
          memo: '',
        },
        when,
      );
      if (suggestionId) suggestions[suggestions.length - 1].nextBrewId = brew.id;
      brews.push(brew);
      inventoryTx.push(createRecord({ beanId: bean.id, at: brewAt, deltaG: -doseG, kind: 'brew', brewId: brew.id, memo: '' }, when));

      const strength = tds == null ? 0 : tds < 1.2 ? -1 : tds > 1.42 ? 1 : 0;
      const jar = {
        strength,
        acidity: g > bag.opt ? 1 : 0,
        bitterness: g < bag.opt ? 1 : 0,
        sweetness: stars >= 4 ? 0 : -1,
        body: 0,
        astringency: g < bag.opt - 1 ? 1 : 0,
      };
      const tags = [];
      if (jar.acidity > 0) tags.push('酸っぱい');
      if (jar.bitterness > 0) tags.push('苦い');
      if (stars >= 5) tags.push('好き');
      const detailed = rnd() < 0.4;
      const intensity = {};
      const liking = {};
      if (detailed) {
        for (const [key, peak] of Object.entries(LIKING_PEAK)) {
          const it = clamp(Math.round(peak + (rnd() - 0.5) * 10), 0, 15);
          intensity[key] = it;
          liking[key] = clamp(Math.round(8 - Math.abs(it - peak) * 0.6 + (rnd() - 0.5) * 1.5), 1, 9);
        }
      }
      const tasting = createRecord(
        {
          brewId: brew.id,
          by: 'me',
          stage: 'warm',
          stars,
          tags,
          jar,
          intensity: detailed ? intensity : {},
          liking: detailed ? liking : {},
          flavors: stars >= 4 ? bag.flav : [],
          defects: g < bag.opt - 1 ? ['えぐい'] : [],
          memo: '',
          blind: false,
          experimentId: null,
        },
        new Date(when.getTime() + 10 * 60000),
      );
      tastings.push(tasting);

      prevBrew = brew;
      prevTasting = tasting;
      // 次の杯の挽き目：ちょうど良い目盛りへ1つずつ寄せる。合ったら時々ためしに動かす
      if (g > bag.opt) g -= 1;
      else if (g < bag.opt) g += 1;
      else if (rnd() < 0.2) g += rnd() < 0.5 ? -1 : 1;
      if (i === 4 && rnd() < 0.3) g += 1; // 途中で戻すこともある
    });
  });

  return {
    beans,
    inventoryTx,
    equipment,
    recipes: [recipe],
    brews,
    tastings,
    suggestions,
    orders: [],
    frozenPortions: [],
    photos: [],
    experiments: [],
    settings: [], // 設定は入れない（データの画面から入れても、自分の設定を上書きしない）
  };
}
