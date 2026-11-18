// 総点検（2-8）で使う「試すデータ」5種を作る。アプリには含めない（scripts/ は sw.js の一覧に入らない）。
// 使い方：node scripts/debug/make-fixtures.js [YYYY-MM-DD]
//   → tests/fixtures/debug/{empty,minimal,demo,nasty,bulk}.json（書き出しファイルと同じ形。データの画面の「復元」でも読める）
// 日付を省くと今日を基準にする（焙煎日からの日数や「1年前」が今日に合うように）。
// 本物の保存処理（js/db.js）を fake-indexeddb の上で動かして作るので、在庫の履歴などのつながりはアプリと同じになる。
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  openDb,
  addBean,
  addRecipe,
  addEquipment,
  saveBrew,
  saveTasting,
  freezeBean,
  addOrder,
  addInventoryTx,
  deleteBean,
  deleteRecipe,
  deleteEquipment,
  setBeanStatus,
  addExperiment,
  attachBrewToExperiment,
  updateExperiment,
  updateSettings,
  setBrewWeather,
  getBrew,
  addWish,
  deleteWish,
  putAll,
  exportAll,
  getBeanWithTx,
  addGift,
  setGiftFeedback,
  setHandoverNote,
} from '../../js/db.js';
import { normalizeBeanInput } from '../../js/core/beans.js';
import { normalizeRecipeInput, newRecipeState, planFromRecipe } from '../../js/core/recipes.js';
import { normalizeEquipmentInput } from '../../js/core/equipment.js';
import { newDraft, finishDraft, initialActualInput, normalizeActualInput, buildBrew } from '../../js/core/brews.js';
import { normalizeTastingInput } from '../../js/core/tastings.js';
import { normalizeFreezeInput } from '../../js/core/frozen.js';
import { normalizeOrderItem, orderFields } from '../../js/core/orders.js';
import { normalizeCompareInput, buildExperiment, setRating } from '../../js/core/compare.js';
import { adjustPlan } from '../../js/core/plan-adjust.js';
import { remainingG } from '../../js/core/inventory.js';
import { makeDemoData } from '../../js/core/demo-data.js';
import { makeBackup } from '../../js/core/backup.js';
import { localYmd } from '../../js/core/format.js';
import { normalizeWishInput } from '../../js/core/wishlist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tests/fixtures/debug');

const arg = process.argv[2];
const NOW = arg ? new Date(`${arg}T08:00:00`) : new Date();
const ago = (days, h = 7, m = 30) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(h, m, 0, 0);
  return d;
};
const ymdAgo = (days) => localYmd(ago(days));
const freshDb = (name) => openDb(`debug-${name}`, { indexedDB: new IDBFactory(), IDBKeyRange });

function ok({ value, errors }, label) {
  if (errors && Object.keys(errors).length) throw new Error(`${label}: ${JSON.stringify(errors)}`);
  return value;
}
const bean = (db, raw, at) => addBean(db, ok(normalizeBeanInput(raw), `豆 ${raw.name}`), at);
const recipe = (db, raw, at) => addRecipe(db, ok(normalizeRecipeInput({ ...newRecipeState(), ...raw }), `レシピ ${raw.name}`), at);

/** レシピからタイマーで淹れた1杯を保存する */
async function brew(db, { recipe: r, bean: b, at, doseG, iced = false, portion = null, compareId = null, memo = '' }) {
  let plan = planFromRecipe(r);
  if (iced) plan = adjustPlan(plan, { iced: true });
  const start = at.getTime() - 240_000;
  const draft = { ...finishDraft({ ...newDraft(plan, b?.id ?? null, start), laps: [9, 50, 94, 139, 183] }, start + 215_000), compareId };
  const input = { ...initialActualInput(draft), memo };
  if (doseG != null) input.doseG = String(doseG);
  const value = ok(normalizeActualInput(input), '実績');
  const { brew: saved } = await saveBrew(db, buildBrew({ draft, value, at: at.toISOString(), bean: b, portion }), at);
  return saved;
}
const rate = (db, brewId, raw, at) => saveTasting(db, brewId, ok(normalizeTastingInput(raw, { allowEmpty: true }), '評価'), at);

async function save(name, data) {
  await mkdir(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.json`);
  await writeFile(file, `${JSON.stringify(data)}\n`);
  const counts = Object.entries(data.tables)
    .filter(([, rows]) => rows.length)
    .map(([k, rows]) => `${k} ${rows.length}`)
    .join('、');
  console.log(`${path.relative(ROOT, file)}：${counts || '空'}`);
}

// 1. 空
async function empty() {
  return makeBackup({}, NOW);
}

// 2. 最小：豆1・レシピ1・1杯（評価あり）
async function minimal() {
  const db = freshDb('minimal');
  const b = await bean(db, { name: 'エチオピア イルガチェフェ', actualWeightG: '200', roastLevel: 'シティ', roastDate: ymdAgo(9), shop: '珈琲問屋' }, ago(7));
  const r = await recipe(db, { name: 'いつもの', doseG: '15' }, ago(7));
  const br = await brew(db, { recipe: r, bean: b, at: ago(0, 7, 10) });
  await rate(db, br.id, { stars: 4, jar: { strength: 0, acidity: 1, bitterness: 0, sweetness: 0, body: 0, astringency: 0 } }, ago(0, 7, 20));
  return exportAll(db, NOW);
}

// 3. デモ（分析の画面の「デモで見る」と同じ80杯）
async function demo() {
  return makeBackup(makeDemoData(NOW), NOW);
}

// 4. 意地悪：表示や計算が崩れやすい記録を集めたもの
async function nasty() {
  const db = freshDb('nasty');
  const LONG = 'エチオピア・イルガチェフェ・ゲデブ・チェルベサ・ナチュラル・G1・トップスペシャルティ・限定ロット2026年新豆入荷記念特別焙煎（とても長い名前）';
  const grinder = await addEquipment(db, ok(normalizeEquipmentInput({ kind: 'grinder', name: '消すミル' }), 'ミル'), ago(400));
  const r = await recipe(db, { name: 'いつもの', doseG: '15' }, ago(400));
  const rLong = await recipe(db, { name: `${LONG}のためのレシピ`, doseG: '20' }, ago(30));
  const rDead = await recipe(db, { name: '消したレシピ', doseG: '12' }, ago(60));

  // 1年前の記録
  const old = await bean(db, { name: '1年前のケニア', actualWeightG: '100', roastLevel: 'ハイ', roastDate: ymdAgo(380) }, ago(375));
  const brOld = await brew(db, { recipe: r, bean: old, at: ago(370) });
  await rate(db, brOld.id, { stars: 5, tags: ['好き'] }, ago(370, 8));
  await setBeanStatus(db, old.id, 'finished', ago(360));

  // 長い名前（記号とHTMLに見える文字も入れる）
  const long = await bean(db, { name: LONG, actualWeightG: '500', roastLevel: 'ライト', roastDate: ymdAgo(5), memo: '<b>太字にならないこと</b> & "引用" \'1\' '.repeat(10), flavorNotes: 'ジャスミン、ベルガモット、ピーチ、ハニー、ブラックティー、レモン、ライム、マスカット' }, ago(3));
  const brLong = await brew(db, { recipe: rLong, bean: long, at: ago(2), memo: 'とても長いメモ。'.repeat(40) });
  await rate(db, brLong.id, { stars: 3, memo: 'あ'.repeat(300) }, ago(2, 8));

  // 残り0g（ちょうど使い切ったが「開封済み」のまま）
  const zero = await bean(db, { name: '残り0gのグアテマラ', actualWeightG: '30', roastLevel: 'シティ', roastDate: ymdAgo(20) }, ago(18));
  await brew(db, { recipe: r, bean: zero, at: ago(10), doseG: 15 });
  await brew(db, { recipe: r, bean: zero, at: ago(9), doseG: 15 });

  // 在庫がマイナス（記録のつじつまが合わない：量った分より多く淹れた）
  const minus = await bean(db, { name: '在庫マイナスのブラジル', actualWeightG: '20', roastLevel: 'フルシティ', roastDate: ymdAgo(15) }, ago(14));
  await brew(db, { recipe: r, bean: minus, at: ago(8), doseG: 15 });
  await brew(db, { recipe: r, bean: minus, at: ago(7), doseG: 15 });

  // 冷凍だけ（常温0g、冷凍庫に3袋）
  const frozen = await bean(db, { name: '冷凍だけのコロンビア', actualWeightG: '45', roastLevel: 'シティ', roastDate: ymdAgo(40) }, ago(38));
  await freezeBean(db, frozen.id, ok(normalizeFreezeInput({ gramsPerPortion: '15', count: '3', frozenDate: ymdAgo(36) }, { availableG: 45 }), '冷凍'), ago(36));

  // カフェインレス
  const decaf = await bean(db, { name: 'カフェインレス コロンビア', actualWeightG: '200', roastLevel: 'フルシティ', roastDate: ymdAgo(12), decaf: true }, ago(10));
  const brDecaf = await brew(db, { recipe: r, bean: decaf, at: ago(1, 21, 0) });
  await rate(db, brDecaf.id, { stars: 4 }, ago(1, 21, 15));

  // 焙煎日なし
  const noRoast = await bean(db, { name: '焙煎日なしのマンデリン', labelWeightG: '200', roastLevel: 'フレンチ' }, ago(6));
  const brNoRoast = await brew(db, { recipe: r, bean: noRoast, at: ago(4) });
  await rate(db, brNoRoast.id, { stars: 2, tags: ['苦い'], jar: { strength: 1, acidity: 0, bitterness: 1, sweetness: -1, body: 1, astringency: 1 } }, ago(4, 8));

  // アイス（氷で割る計画）
  const brIce = await brew(db, { recipe: r, bean: long, at: ago(1, 14, 0), iced: true });
  await rate(db, brIce.id, { stars: 4 }, ago(1, 14, 20));

  // 評価なし（今朝の1杯。24時間以内なので評価の促しが出るはず）
  await brew(db, { recipe: r, bean: decaf, at: ago(0, 6, 50) });
  // ★なし・一言なしの空の評価
  const brEmpty = await brew(db, { recipe: r, bean: decaf, at: ago(3) });
  await rate(db, brEmpty.id, {}, ago(3, 8));

  // 豆なしの1杯（豆を選ばずに淹れた）
  const brNoBean = await brew(db, { recipe: r, bean: null, at: ago(5) });
  await rate(db, brNoBean.id, { stars: 3 }, ago(5, 8));

  // 入荷待ち（注文メールから。まだ届いていない）
  const items = [
    ok(normalizeOrderItem({ name: '入荷待ちのルワンダ', labelWeightG: '200', qty: '2', priceJpy: '1450', roastLevel: 'シティ' }), '品目'),
    ok(normalizeOrderItem({ name: '入荷待ちのパナマ ゲイシャ', labelWeightG: '100', qty: '1', priceJpy: '3800', roastLevel: 'ハイ' }), '品目'),
  ];
  await addOrder(db, orderFields({ orderNo: 'TEST-0001', orderDate: ymdAgo(1), shippingJpy: 0, items }), items, ago(1));

  // 削除済み：豆（抽出の記録は残す）・レシピ・器具
  const dead = await bean(db, { name: '削除した豆', actualWeightG: '200', roastLevel: 'シティ', roastDate: ymdAgo(30) }, ago(28));
  const brDead = await brew(db, { recipe: rDead, bean: dead, at: ago(20) });
  await rate(db, brDead.id, { stars: 1, tags: ['えぐい'] }, ago(20, 8));
  await deleteBean(db, dead.id, ago(19));
  await deleteRecipe(db, rDead.id, ago(19));
  await deleteEquipment(db, grinder.id, ago(19));

  // 飲み比べの途中（3袋のうち2袋だけ淹れて、1杯だけ★を付けた）
  const roasts = [];
  for (const [lv, days] of [['ハイ', 8], ['シティ', 8], ['フルシティ', 8]]) {
    roasts.push(await bean(db, { name: '飲み比べ用 エチオピア', actualWeightG: '100', roastLevel: lv, roastDate: ymdAgo(days) }, ago(6)));
  }
  const value = ok(normalizeCompareInput({ beanIds: roasts.map((b) => b.id), recipeId: r.id, blind: true }, roasts), '飲み比べ');
  let exp = await addExperiment(db, buildExperiment({ value, beans: roasts }), ago(0, 7, 0));
  for (const b of roasts.slice(0, 2)) {
    const br = await brew(db, { recipe: r, bean: b, at: ago(0, 7, 20), compareId: exp.id });
    exp = await attachBrewToExperiment(db, exp.id, { brewId: br.id, beanId: b.id }, ago(0, 7, 21));
  }
  await updateExperiment(db, exp.id, setRating(exp, 1, { stars: 4, word: '明るい' }), ago(0, 7, 40));

  // 気になる豆（F6）：長い名前と記号、銘柄だけ、消したもの、買ったもの
  await addWish(db, ok(normalizeWishInput({ name: `${LONG}<script>`, country: 'エチオピア', process: 'ナチュラル', roastLevel: 'ライト', priceJpy: '12345', labelWeightG: '100', memo: 'メモ'.repeat(60), productUrl: 'https://example.com/' + 'a'.repeat(120) }), '気になる豆'), ago(2));
  await addWish(db, ok(normalizeWishInput({ name: '銘柄だけ' }), '気になる豆'), ago(2));
  const deadWish = await addWish(db, ok(normalizeWishInput({ name: '消した気になる豆', country: 'ボリビア' }), '気になる豆'), ago(2));
  await deleteWish(db, deadWish.id, ago(1));
  await addWish(db, ok(normalizeWishInput({ name: '入荷待ちのルワンダ', country: 'ルワンダ' }), '気になる豆'), ago(3));

  // 天気（X16）：極端な値の杯と、壊れた天気の杯（手で書き換えたファイルを想定）
  await setBrewWeather(db, [{ id: brIce.id, weather: { tempC: 39.9, humidity: 100, code: 99 } }, { id: brDecaf.id, weather: { tempC: -25.4, humidity: 3, code: 75 } }], ago(1));
  const broken = await getBrew(db, brLong.id);
  await db.table('brews').put({ ...broken, context: { ...broken.context, weather: { tempC: 'あつい', humidity: null, code: 'x' } } });

  // 設定：カフェインの区切りと、いつもの粉量。天気の地点は長い名前の手入力（通信できないときの様子も見る）
  await updateSettings(db, { caffeineCutoff: '15:00', defaultDoseG: 15, weatherPlace: { key: 'custom', name: 'とても長い地点の名前'.repeat(3).slice(0, 30), lat: 35.68, lon: 139.76 }, hotDayC: 20 }, ago(30));

  // おすそ分け（X34）：長い名前と感想、相手なし（3-5 より前の形）
  const g1 = await addGift(db, { beanId: long.id, g: 50, recipient: 'とても長い名前の職場のとなりの席の先輩さん<b>'.slice(0, 30), memo: '挽いて渡した。'.repeat(20).slice(0, 200) }, ago(1, 19));
  await setGiftFeedback(db, g1.id, '<script>感想</script>\n' + 'おいしかった。'.repeat(50).slice(0, 380), ago(0, 7));
  await addInventoryTx(db, { beanId: zero.id, deltaG: -5, kind: 'gift', memo: '' }, ago(9, 20));
  // お手入れ（D4）：壊れた設定のケトル（手で書き換えたファイルを想定）と、知らせないにしたミル
  const kettle = await addEquipment(db, ok(normalizeEquipmentInput({ kind: 'kettle', name: '壊れた設定のケトル' }), 'ケトル'), ago(200));
  await db.table('equipment').put({ ...kettle, maintenance: { enabled: 'yes', everyDays: 'abc', everyCups: -3, lastDoneAt: 'きのう', snoozedUntil: 12, log: 'x' } });
  const mill = await addEquipment(db, ok(normalizeEquipmentInput({ kind: 'grinder', name: '知らせないミル' }), 'ミル'), ago(300));
  await db.table('equipment').put({ ...mill, maintenance: { enabled: false, everyDays: 30, everyCups: 50 } });
  // 申し送り（X32）：1年前の袋に長い一言、同じ銘柄の新しい袋（未開封）
  await setHandoverNote(db, old.id, '<b>次は</b>'.concat('焙煎10日からが良い。'.repeat(20)).slice(0, 200), ago(360));
  await bean(db, { name: '1年前のケニア', actualWeightG: '100', roastLevel: 'シティ', roastDate: ymdAgo(3) }, ago(1));

  // 在庫のつじつまを手で確かめる用のメモ（コンソールに出す）
  const { txs } = await getBeanWithTx(db, minus.id);
  console.log(`  意地悪：在庫マイナスの豆の残り = ${remainingG(txs)}g`);
  return exportAll(db, NOW);
}

// 5. 大量：デモの80杯を13回ぶん（約1年半・1040杯）。古い回の袋は全部「飲み切り」にする
async function bulk() {
  const tables = {};
  for (let k = 0; k < 13; k++) {
    const at = new Date(NOW);
    at.setDate(at.getDate() - k * 42);
    const part = makeDemoData(at);
    if (k > 0) {
      part.beans = part.beans.map((b) => ({ ...b, status: 'finished' }));
      part.recipes = []; // レシピと器具は1回ぶんだけにする（つながりは最初の回の器具・レシピIDではないが、削除済みの器具と同じ扱いになる）
      part.equipment = [];
    }
    for (const [name, rows] of Object.entries(part)) (tables[name] ??= []).push(...rows);
  }
  // 最初の回以外の抽出も同じレシピ・器具を指すように付け替える
  const r0 = tables.recipes[0];
  const eq = Object.fromEntries(tables.equipment.map((e) => [e.name, e.id]));
  const dripperId = eq['デモ V60 02'];
  const grinderId = eq['デモ 手挽きミル'];
  for (const b of tables.brews) {
    b.recipeId = r0.id;
    b.equipment = { ...b.equipment, dripperId, grinderId, filterId: eq['デモ V60用 無漂白'], kettleId: eq['デモ 細口ケトル'], waterId: eq['デモ 水道水＋浄水器'] };
    b.planned.grind.grinderId = grinderId;
    b.actual.grind.grinderId = grinderId;
  }
  for (const s of tables.suggestions) s.recipeId = r0.id;
  const db = freshDb('bulk');
  await putAll(db, tables);
  return exportAll(db, NOW);
}

console.log(`基準日：${localYmd(NOW)}`);
for (const [name, make] of Object.entries({ empty, minimal, demo, nasty, bulk })) await save(name, await make());
