// 端末内のデータベース（IndexedDB を Dexie で扱う）
// 計算や判定は js/core/ に置き、ここは出し入れだけにする。

import Dexie from '../vendor/dexie/dexie.mjs';
import { TABLES, SETTINGS_ID, createRecord, updateRecord, markDeleted } from './core/records.js';
import { beansFromOrder } from './core/orders.js';
import { initialStockG } from './core/roast.js';
import { remainingG, adjustDelta, stockFieldsChanged, statusAfterUnfinish } from './core/inventory.js';
import { makeBackup, mergeRecords } from './core/backup.js';
import { buildTasting, pickTasting, pickUnratedBrew, tastingsByStage, pickCoolPrompt, normalizeTastingInput, DEFAULT_STAGE } from './core/tastings.js';
import { suggestNext, basePlanForNext, buildSuggestion, pickSuggestionForBrew, linkSuggestions } from './core/dialin.js';
import { parseNumber } from './core/beans.js';
import { nextLabelNos, buildPortions, freezeMemo, isInFreezer } from './core/frozen.js';
import { localYmd } from './core/format.js';
import { buildPhoto, photosOfBrew } from './core/photos.js';
import { attachBrew, tastingsToSave } from './core/compare.js';
import { withTds } from './core/extraction.js';
import { withWeather } from './core/weather.js';
import { markDone, snooze } from './core/maintenance.js';

/** 本番のデータベース名（保存テストの pourfolio-storage-test とは別） */
export const DB_NAME = 'pourfolio';

/**
 * データベースを開く。
 * 表の形（検索に使う項目）を変えるときは version を上げ、移行処理とテストを足す。
 * @param {string} [name]
 * @param {object} [options] テストでは { indexedDB, IDBKeyRange } を渡す
 */
export function openDb(name = DB_NAME, options) {
  const db = new Dexie(name, options);
  db.version(1).stores({
    beans: 'id, updatedAt, roastDate',
    inventoryTx: 'id, beanId, brewId, at, updatedAt',
    equipment: 'id, kind, updatedAt',
    recipes: 'id, parentId, updatedAt',
    brews: 'id, at, beanId, recipeId, updatedAt',
    tastings: 'id, brewId, updatedAt',
    settings: 'id',
  });
  // 版2：提案ログ（F1）の表を足す。既存の表と記録はそのまま（移行で書き換える記録はない）
  db.version(2).stores({
    suggestions: 'id, brewId, beanId, updatedAt',
  });
  // 版3：珈琲問屋への注文（X29）の表を足す。豆の「入荷待ち」と orderId は検索に使わないので索引は足さない
  db.version(3).stores({
    orders: 'id, orderDate, updatedAt',
  });
  // 版4：冷凍の小分けの袋（C4）の表を足す。既存の表と記録はそのまま（移行で書き換える記録はない）
  db.version(4).stores({
    frozenPortions: 'id, beanId, updatedAt',
  });
  // 版5：写真（A7）と飲み比べ（X27）の表を足す。既存の表と記録はそのまま（移行で書き換える記録はない）
  db.version(5).stores({
    photos: 'id, brewId, updatedAt',
    experiments: 'id, updatedAt',
  });
  // 版6：気になる豆（F6、spec 9章の Wishlist）の表を足す。既存の表と記録はそのまま（移行で書き換える記録はない）
  db.version(6).stores({
    wishlist: 'id, updatedAt',
  });
  return db;
}

const allTables = (db) => TABLES.map((name) => db.table(name));

/** 全部の表の記録を { 表の名前: [...] } で読む（削除の印が付いたものも含む） */
export async function readAll(db) {
  const out = {};
  await db.transaction('r', allTables(db), async () => {
    for (const name of TABLES) out[name] = await db.table(name).toArray();
  });
  return out;
}

/** 表ごとの件数（削除の印が付いたものは数えない） */
export async function countAlive(db) {
  const counts = {};
  await db.transaction('r', allTables(db), async () => {
    for (const name of TABLES) {
      counts[name] = await db.table(name).filter((r) => r.deletedAt == null).count();
    }
  });
  return counts;
}

/** 書き出す中身を作る */
export async function exportAll(db, now = new Date()) {
  return makeBackup(await readAll(db), now);
}

/**
 * 書き出しファイルの中身（parseBackup 済み）を統合して復元する。
 * @returns {Promise<Record<string, {added:number, updated:number, skipped:number}>>}
 */
export async function restoreBackup(db, backup) {
  const result = {};
  await db.transaction('rw', allTables(db), async () => {
    for (const name of TABLES) {
      const table = db.table(name);
      const incoming = backup.tables[name] ?? [];
      const existing = await table.bulkGet(incoming.map((r) => r.id));
      let { toPut, added, updated, skipped } = mergeRecords(existing, incoming);
      // 設定のうち端末だけのもの（最後に見た版など）は、今の端末の値を残す（2-8 の6番）
      if (name === 'settings') toPut = toPut.map((r) => keepDeviceSettings(r, existing.find((e) => e?.id === r.id)));
      if (toPut.length) await table.bulkPut(toPut);
      result[name] = { added, updated, skipped };
    }
  });
  return result;
}

function keepDeviceSettings(incoming, current) {
  if (!current) return incoming;
  const out = { ...incoming };
  for (const k of DEVICE_SETTINGS_KEYS) {
    if (k === 'lastBackupAt') continue;
    if (k in current) out[k] = current[k];
    else delete out[k];
  }
  // 最後に書き出した日時は、どちらか新しいほう（どちらの書き出しも、バックアップがある印なので）
  out.lastBackupAt = laterIso(current.lastBackupAt, incoming.lastBackupAt);
  return out;
}

const laterIso = (a, b) => {
  const ta = Date.parse(a ?? '');
  const tb = Date.parse(b ?? '');
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? null : b;
  if (Number.isNaN(tb)) return a;
  return tb > ta ? b : a;
};

/** 全部の表を空にする */
export async function clearAll(db) {
  await db.transaction('rw', allTables(db), async () => {
    for (const name of TABLES) await db.table(name).clear();
  });
}

/** 記録をまとめて入れる（サンプル投入用） */
export async function putAll(db, tables) {
  await db.transaction('rw', allTables(db), async () => {
    for (const name of TABLES) {
      if (tables[name]?.length) await db.table(name).bulkPut(tables[name]);
    }
  });
}

/**
 * 自動で作った設定の日時（いちばん古い日時）。新しい端末で開いただけの設定が、
 * 書き出しファイルの設定より「新しい」と判断されて復元で捨てられないように（2-8 の6番）
 */
export const BLANK_SETTINGS_AT = new Date(0);

/** 設定のうち、その端末だけのもの（復元しても今の端末の値を残す。変えても updatedAt を進めない） */
// 最後に書き出した日時（lastBackupAt）も、書き出すたびに設定の updatedAt を進めると、別の端末で変えた設定が
// 復元で「古い」と判断されて捨てられるため、ここに入れる（総仕上げの58番。復元ではどちらか新しい日時を残す）
export const DEVICE_SETTINGS_KEYS = Object.freeze(['lastSeenVersion', 'lastBackupAt']);

/** 設定（1件）を読む。なければ作って返す（作った日時は BLANK_SETTINGS_AT） */
export async function getSettings(db, now = new Date()) {
  const cur = await db.table('settings').get(SETTINGS_ID);
  if (cur) return cur;
  const rec = createRecord({ id: SETTINGS_ID, lastBackupAt: null }, BLANK_SETTINGS_AT);
  await db.table('settings').put(rec);
  return rec;
}

/**
 * その端末だけの設定（DEVICE_SETTINGS_KEYS）を変える。updatedAt は進めない
 * （「最後に見た版」を覚えただけで、書き出しファイルの設定に負けなくならないように）
 */
export async function setDeviceSettings(db, changes) {
  const bad = Object.keys(changes).filter((k) => !DEVICE_SETTINGS_KEYS.includes(k));
  if (bad.length) throw new Error(`端末だけの設定ではありません：${bad.join('、')}`);
  const cur = await getSettings(db);
  const next = { ...cur, ...changes };
  await db.table('settings').put(next);
  return next;
}

/** 設定を一部だけ変える */
export async function updateSettings(db, changes, now = new Date()) {
  const cur = await getSettings(db, now);
  const next = updateRecord(cur, changes, now);
  await db.table('settings').put(next);
  return next;
}

// ---- 豆と在庫（C1・C2） ----

const alive = (r) => r.deletedAt == null;
const nowIso = (now) => new Date(now).toISOString();

/** 削除の印が付いていない豆の一覧 */
export async function listBeans(db) {
  return (await db.table('beans').toArray()).filter(alive);
}

/** 削除の印が付いていない在庫履歴の全部 */
export async function listAliveTx(db) {
  return (await db.table('inventoryTx').toArray()).filter(alive);
}

/**
 * 豆1つと、その在庫履歴・冷凍の袋（削除の印が付いたものは除く。袋は取り出したものも含む）。
 * 豆がない・削除済みなら null
 */
export async function getBeanWithTx(db, beanId) {
  const bean = await db.table('beans').get(beanId);
  if (!bean || !alive(bean)) return null;
  const txs = (await db.table('inventoryTx').where('beanId').equals(beanId).toArray()).filter(alive);
  const portions = (await db.table('frozenPortions').where('beanId').equals(beanId).toArray()).filter(alive);
  return { bean, txs, portions };
}

/** 削除の印が付いていない冷凍の袋の全部（取り出したものも含む） */
export async function listFrozenPortions(db) {
  return (await db.table('frozenPortions').toArray()).filter(alive);
}

/**
 * 入庫の履歴を、豆の重量の入力に合わせる（なければ作る、量がなければ削除の印を付ける）。
 * 豆の登録と、編集で重量を直したときに使う。量り直しの履歴があれば入庫の量は変えない。
 */
async function syncInboundTx(db, bean, now) {
  const allBeans = await db.table('beans').toArray();
  // 入荷待ちの豆はまだ手元にないので、入庫の履歴を作らない（届いたときに作る）
  const stock = bean.status === 'ordered' ? null : initialStockG(bean, allBeans);
  const txs = (await db.table('inventoryTx').where('beanId').equals(bean.id).toArray()).filter(alive);
  const inbound = txs.find((t) => t.kind === 'in');
  if (!stock) {
    if (inbound) await db.table('inventoryTx').put(markDeleted(inbound, now));
    return null;
  }
  const memo = stock.estimated ? `生豆時の表記から見積もり（目減り${stock.lossPct}%）` : '';
  if (inbound) {
    // 量り直した後は、量った値のほうが正しいので入庫の量を書き換えない
    if (txs.some((t) => t.kind === 'adjust')) return stock;
    if (inbound.deltaG !== stock.g || inbound.memo !== memo) {
      await db.table('inventoryTx').put(updateRecord(inbound, { deltaG: stock.g, memo }, now));
    }
  } else {
    const at = bean.arrivalDate ? new Date(`${bean.arrivalDate}T12:00:00`).toISOString() : nowIso(now);
    await db.table('inventoryTx').put(createRecord({ beanId: bean.id, at, deltaG: stock.g, kind: 'in', brewId: null, memo }, now));
  }
  return stock;
}

/**
 * 豆を登録し、入庫の履歴を1件作る。
 * @param {object} fields normalizeBeanInput の value
 * @returns {Promise<object>} 保存した豆
 */
export async function addBean(db, fields, now = new Date()) {
  const bean = createRecord(fields, now);
  await db.transaction('rw', db.table('beans'), db.table('inventoryTx'), async () => {
    await db.table('beans').put(bean);
    await syncInboundTx(db, bean, now);
  });
  return bean;
}

/** 豆を直す。重量が変わったら入庫の履歴も直す */
export async function updateBean(db, beanId, changes, now = new Date()) {
  let next;
  await db.transaction('rw', db.table('beans'), db.table('inventoryTx'), async () => {
    const cur = await db.table('beans').get(beanId);
    if (!cur || !alive(cur)) throw new Error('豆が見つかりません');
    next = updateRecord(cur, changes, now);
    await db.table('beans').put(next);
    // メモや名前だけ直したときは入庫の量を変えない（目減り率を学び直していても、2-8の38番）
    if (stockFieldsChanged(cur, next)) await syncInboundTx(db, next, now);
  });
  return next;
}

// ---- 注文と入荷待ち（X29） ----

/**
 * 注文を1件保存し、品目から入荷待ちの豆を1袋ずつ登録する
 * @param {object} order orderFields の値
 * @param {object[]} items normalizeOrderItem の value の配列
 * @returns {Promise<{order:object, beans:object[]}>}
 */
export async function addOrder(db, order, items, now = new Date()) {
  const rec = createRecord(order, now);
  const beans = beansFromOrder({ orderId: rec.id, orderDate: rec.orderDate, items }).map((b) => createRecord(b, now));
  await db.transaction('rw', db.table('orders'), db.table('beans'), async () => {
    await db.table('orders').put(rec);
    await db.table('beans').bulkPut(beans);
  });
  return { order: rec, beans };
}

/** 削除の印が付いていない注文（新しい順） */
export async function listOrders(db) {
  const rows = (await db.table('orders').toArray()).filter(alive);
  return rows.sort((a, b) => String(b.orderDate).localeCompare(String(a.orderDate)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * 入荷待ちの豆が届いた：実重量・到着日・焙煎日を入れて未開封にし、入庫の履歴を作る
 * @param {object} changes arrivalChanges の value
 */
export async function markArrived(db, beanId, changes, now = new Date()) {
  return updateBean(db, beanId, changes, now);
}

/** 豆の状態だけを変える（未開封・開封済み・飲み切り） */
export async function setBeanStatus(db, beanId, status, now = new Date()) {
  const cur = await db.table('beans').get(beanId);
  if (!cur || !alive(cur)) throw new Error('豆が見つかりません');
  const next = updateRecord(cur, { status }, now);
  await db.table('beans').put(next);
  return next;
}

/** 次の自分への一言（X32）を書く（空なら消す） */
export async function setHandoverNote(db, beanId, note, now = new Date()) {
  return updateBean(db, beanId, { handoverNote: note, handoverNoteAt: note ? nowIso(now) : null }, now);
}

/** 飲み切りを取り消す：前の状態（未開封・開封済み）に戻す（2-8の42番） */
export async function unfinishBean(db, beanId, now = new Date()) {
  const txs = (await db.table('inventoryTx').where('beanId').equals(beanId).toArray()).filter(alive);
  return setBeanStatus(db, beanId, statusAfterUnfinish(txs), now);
}

/** 豆を削除する（豆と在庫履歴・冷凍の袋に削除の印を付ける） */
export async function deleteBean(db, beanId, now = new Date()) {
  await db.transaction('rw', db.table('beans'), db.table('inventoryTx'), db.table('frozenPortions'), async () => {
    const cur = await db.table('beans').get(beanId);
    if (cur && alive(cur)) await db.table('beans').put(markDeleted(cur, now));
    const txs = (await db.table('inventoryTx').where('beanId').equals(beanId).toArray()).filter(alive);
    if (txs.length) await db.table('inventoryTx').bulkPut(txs.map((t) => markDeleted(t, now)));
    const portions = (await db.table('frozenPortions').where('beanId').equals(beanId).toArray()).filter(alive);
    if (portions.length) await db.table('frozenPortions').bulkPut(portions.map((p) => markDeleted(p, now)));
  });
}

/**
 * 在庫の増減を1件記録する。
 * @param {{beanId:string, deltaG:number, kind:string, memo?:string, brewId?:string|null, at?:string}} fields
 */
export async function addInventoryTx(db, fields, now = new Date()) {
  const tx = createRecord({ at: nowIso(now), brewId: null, memo: '', ...fields }, now);
  await db.table('inventoryTx').put(tx);
  return tx;
}

/**
 * おすそ分け（X34）：渡した量を在庫から引き、相手とメモを残す。未開封の豆なら開封済みにする
 * @param {{beanId:string, g:number, recipient?:string, memo?:string}} p normalizeGiftInput の value と豆のID
 */
export async function addGift(db, { beanId, g, recipient = '', memo = '' }, now = new Date()) {
  let tx;
  await db.transaction('rw', db.table('beans'), db.table('inventoryTx'), async () => {
    const bean = await db.table('beans').get(beanId);
    if (!bean || !alive(bean)) throw new Error('豆が見つかりません');
    tx = await addInventoryTx(db, { beanId, deltaG: -g, kind: 'gift', recipient, memo, feedback: '' }, now);
    if (bean.status === 'unopened') await db.table('beans').put(updateRecord(bean, { status: 'open' }, now));
  });
  return tx;
}

/** おすそ分けにもらった感想を書く（空なら消す） */
export async function setGiftFeedback(db, txId, feedback, now = new Date()) {
  const cur = await db.table('inventoryTx').get(txId);
  if (!cur || !alive(cur) || cur.kind !== 'gift') throw new Error('おすそ分けの記録が見つかりません');
  const next = updateRecord(cur, { feedback, feedbackAt: feedback ? nowIso(now) : null }, now);
  await db.table('inventoryTx').put(next);
  return next;
}

/**
 * 1杯淹れた分を在庫から減らす（アプリで淹れなかった1杯用。抽出の記録は作らない。アプリで淹れたときは saveBrew）。
 * 未開封の豆なら開封済みにする。
 */
export async function recordCupUsage(db, beanId, doseG, now = new Date()) {
  let tx;
  await db.transaction('rw', db.table('beans'), db.table('inventoryTx'), async () => {
    tx = await addInventoryTx(db, { beanId, deltaG: -doseG, kind: 'brew' }, now);
    const bean = await db.table('beans').get(beanId);
    if (bean && bean.status === 'unopened') await db.table('beans').put(updateRecord(bean, { status: 'open' }, now));
  });
  return tx;
}

/**
 * 量り直した重さに合わせて、差の分だけ調整の履歴を足す。差が0なら何もしない。
 * @returns {Promise<object|null>} 足した履歴
 */
export async function measureBean(db, beanId, measuredG, now = new Date()) {
  let tx = null;
  await db.transaction('rw', db.table('inventoryTx'), async () => {
    const txs = (await db.table('inventoryTx').where('beanId').equals(beanId).toArray()).filter(alive);
    const delta = adjustDelta(remainingG(txs), measuredG);
    if (delta !== 0) tx = await addInventoryTx(db, { beanId, deltaG: delta, kind: 'adjust', memo: `量り直し：${measuredG}g` }, now);
  });
  return tx;
}

/**
 * 在庫履歴1件を取り消す（削除の印を付ける）。
 * - 冷凍：その時に作った袋も消す。取り出した袋があるときは取り消せない（エラー）
 * - 冷凍から取り出し：袋を冷凍庫に戻す
 */
export async function deleteInventoryTx(db, txId, now = new Date()) {
  await db.transaction('rw', db.table('beans'), db.table('inventoryTx'), db.table('frozenPortions'), async () => {
    const cur = await db.table('inventoryTx').get(txId);
    if (!cur || !alive(cur)) return;
    // 抽出の記録とつながった「抽出」は取り消せない。記録が残ったまま残りだけ増え、つじつまが合わなくなるため（総仕上げの57番）
    if (cur.kind === 'brew' && cur.brewId) throw new Error('抽出の記録とつながっているため取り消せません。残りが違うときは「量り直す」で合わせてください');
    if (cur.kind === 'freeze') {
      const portions = (await db.table('frozenPortions').where('beanId').equals(cur.beanId).toArray()).filter(
        (p) => alive(p) && p.freezeTxId === cur.id,
      );
      if (portions.some((p) => !isInFreezer(p))) throw new Error('取り出した袋があるため、この冷凍は取り消せません');
      if (portions.length) await db.table('frozenPortions').bulkPut(portions.map((p) => markDeleted(p, now)));
    }
    // 抽出で使った袋の取り出しは取り消せない。袋だけ冷凍庫に戻り、粉の分が二重に数えられるため（2-8 の9番）
    if (cur.kind === 'thaw' && cur.brewId) throw new Error('抽出で使った袋の取り出しは取り消せません（抽出の記録とつながっています）');
    if (cur.kind === 'thaw' && cur.portionId) {
      const p = await db.table('frozenPortions').get(cur.portionId);
      if (p && alive(p)) await db.table('frozenPortions').put(updateRecord(p, { takenOutAt: null, takenOutBrewId: null }, now));
    }
    await db.table('inventoryTx').put(markDeleted(cur, now));
    // 取り消して入庫だけになったら、開封済みを未開封に戻す（42番の飲み切りの取り消しと同じ決め方、総仕上げの94番）
    const bean = await db.table('beans').get(cur.beanId);
    if (bean && alive(bean) && bean.status === 'open') {
      const rest = (await db.table('inventoryTx').where('beanId').equals(cur.beanId).toArray()).filter(alive);
      if (statusAfterUnfinish(rest) === 'unopened') await db.table('beans').put(updateRecord(bean, { status: 'unopened' }, now));
    }
  });
}

// ---- 冷凍ストック（C4） ----

/**
 * 常温の豆を小分けにして冷凍する。常温から「冷凍」の履歴で袋の合計を引き、袋を作る。
 * 未開封の豆なら開封済みにする。
 * @param {object} value normalizeFreezeInput の value
 * @returns {Promise<{tx:object, portions:object[]}>}
 */
export async function freezeBean(db, beanId, value, now = new Date()) {
  let tx;
  let portions;
  await db.transaction('rw', db.table('beans'), db.table('inventoryTx'), db.table('frozenPortions'), async () => {
    const bean = await db.table('beans').get(beanId);
    if (!bean || !alive(bean)) throw new Error('豆が見つかりません');
    if (bean.status === 'ordered') throw new Error('まだ届いていない豆は冷凍できません');
    const txs = (await db.table('inventoryTx').where('beanId').equals(beanId).toArray()).filter(alive);
    if (value.totalG > remainingG(txs) + 0.05) throw new Error('常温の残りより多くは冷凍できません');
    const labelNos = nextLabelNos(await db.table('frozenPortions').toArray(), value.count);
    // 今日冷凍したなら今の時刻、前の日付なら その日の昼12時にする
    const at = localYmd(now) === value.frozenDate ? nowIso(now) : new Date(`${value.frozenDate}T12:00:00`).toISOString();
    tx = await addInventoryTx(db, { beanId, deltaG: -value.totalG, kind: 'freeze', at, memo: freezeMemo(value, labelNos) }, now);
    portions = buildPortions({ bean, value, labelNos, freezeTxId: tx.id }).map((p) => createRecord(p, now));
    await db.table('frozenPortions').bulkPut(portions);
    if (bean.status === 'unopened') await db.table('beans').put(updateRecord(bean, { status: 'open' }, now));
  });
  return { tx, portions };
}

/** 袋を取り出して常温に戻す（トランザクションの中で使う） */
async function takeOut(db, portion, { at, brewId = null }, now) {
  const tx = await addInventoryTx(
    db,
    { beanId: portion.beanId, deltaG: portion.grams, kind: 'thaw', at, portionId: portion.id, brewId, memo: `#${portion.labelNo}` },
    now,
  );
  await db.table('frozenPortions').put(updateRecord(portion, { takenOutAt: at, takenOutBrewId: brewId }, now));
  return tx;
}

/**
 * 冷凍の袋を1つ取り出し、その量を常温に戻す
 * @returns {Promise<object>} 足した在庫履歴
 */
export async function takeOutPortion(db, portionId, now = new Date()) {
  let tx;
  await db.transaction('rw', db.table('inventoryTx'), db.table('frozenPortions'), async () => {
    const p = await db.table('frozenPortions').get(portionId);
    if (!p || !isInFreezer(p)) throw new Error('冷凍庫にない袋です');
    tx = await takeOut(db, p, { at: nowIso(now) }, now);
  });
  return tx;
}

// ---- 器具（D1） ----

/** 削除の印が付いていない器具の一覧 */
export async function listEquipment(db) {
  return (await db.table('equipment').toArray()).filter(alive);
}

/** 器具1つ。ない・削除済みなら null */
export async function getEquipment(db, id) {
  const eq = await db.table('equipment').get(id);
  return eq && alive(eq) ? eq : null;
}

/** 「いつも使う」を同じ種類の中で1つだけにする */
async function clearOtherDefaults(db, saved, now) {
  if (!saved.isDefault) return;
  const others = (await db.table('equipment').where('kind').equals(saved.kind).toArray()).filter(
    (e) => alive(e) && e.id !== saved.id && e.isDefault,
  );
  if (others.length) await db.table('equipment').bulkPut(others.map((e) => updateRecord(e, { isDefault: false }, now)));
}

/**
 * 器具を登録する。その種類で最初の1つなら「いつも使う」にする。
 * @param {object} fields normalizeEquipmentInput の value
 */
export async function addEquipment(db, fields, now = new Date()) {
  let eq;
  await db.transaction('rw', db.table('equipment'), async () => {
    const sameKind = (await db.table('equipment').where('kind').equals(fields.kind).toArray()).filter(alive);
    eq = createRecord({ ...fields, isDefault: Boolean(fields.isDefault) || sameKind.length === 0 }, now);
    await db.table('equipment').put(eq);
    await clearOtherDefaults(db, eq, now);
  });
  return eq;
}

/** 器具を直す */
export async function updateEquipment(db, id, changes, now = new Date()) {
  let next;
  await db.transaction('rw', db.table('equipment'), async () => {
    const cur = await db.table('equipment').get(id);
    if (!cur || !alive(cur)) throw new Error('器具が見つかりません');
    next = updateRecord(cur, changes, now);
    await db.table('equipment').put(next);
    await clearOtherDefaults(db, next, now);
  });
  return next;
}

/** 器具を削除する（印を付けるだけ。レシピや抽出の記録に残ったIDはそのまま） */
export async function deleteEquipment(db, id, now = new Date()) {
  await db.transaction('rw', db.table('equipment'), async () => {
    const cur = await db.table('equipment').get(id);
    if (!cur || !alive(cur)) return;
    await db.table('equipment').put(markDeleted(cur, now));
    // 「いつも使う」を削除したら、同じ種類でいちばん新しく直したものを「いつも使う」にする（総仕上げの69番）
    if (!cur.isDefault) return;
    const rest = (await db.table('equipment').toArray()).filter((e) => alive(e) && e.kind === cur.kind);
    if (rest.some((e) => e.isDefault)) return;
    const next = [...rest].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if (next) await db.table('equipment').put(updateRecord(next, { isDefault: true }, now));
  });
}

/** お手入れ（D4）の「済んだ」：前回を今にする */
export async function markMaintenanceDone(db, id, now = new Date()) {
  const cur = await getEquipment(db, id);
  if (!cur) throw new Error('器具が見つかりません');
  const next = updateRecord(cur, { maintenance: markDone(cur.maintenance, now) }, now);
  await db.table('equipment').put(next);
  return next;
}

/** お手入れ（D4）の「あとで」：数日は知らせない */
export async function snoozeMaintenance(db, id, now = new Date()) {
  const cur = await getEquipment(db, id);
  if (!cur) throw new Error('器具が見つかりません');
  const next = updateRecord(cur, { maintenance: snooze(cur.maintenance, now) }, now);
  await db.table('equipment').put(next);
  return next;
}

// ---- レシピ（A1） ----

/** 削除の印が付いていないレシピの一覧 */
export async function listRecipes(db) {
  return (await db.table('recipes').toArray()).filter(alive);
}

/** レシピ1つ。ない・削除済みなら null */
export async function getRecipe(db, id) {
  const r = await db.table('recipes').get(id);
  return r && alive(r) ? r : null;
}

/**
 * レシピを作る（版番号1）。
 * @param {object} fields normalizeRecipeInput の value
 */
export async function addRecipe(db, fields, now = new Date()) {
  const r = createRecord({ ...fields, version: 1, parentId: null }, now);
  await db.table('recipes').put(r);
  return r;
}

/**
 * レシピを直す。上書きして版番号を1つ上げる（抽出の記録は計画の写しを持つので、過去の記録は変わらない）
 */
export async function updateRecipe(db, id, fields, now = new Date()) {
  let next;
  await db.transaction('rw', db.table('recipes'), async () => {
    const cur = await db.table('recipes').get(id);
    if (!cur || !alive(cur)) throw new Error('レシピが見つかりません');
    next = updateRecord(cur, { ...fields, version: (cur.version ?? 1) + 1 }, now);
    await db.table('recipes').put(next);
  });
  return next;
}

/** お気に入りだけを切り替える（淹れ方は変わらないので版番号は上げない） */
export async function setRecipeFavorite(db, id, favorite, now = new Date()) {
  const cur = await db.table('recipes').get(id);
  if (!cur || !alive(cur)) throw new Error('レシピが見つかりません');
  const next = updateRecord(cur, { favorite: Boolean(favorite) }, now);
  await db.table('recipes').put(next);
  return next;
}

/** レシピを削除する（印を付けるだけ） */
export async function deleteRecipe(db, id, now = new Date()) {
  const cur = await db.table('recipes').get(id);
  if (cur && alive(cur)) await db.table('recipes').put(markDeleted(cur, now));
}

// ---- 抽出（A4） ----

/**
 * 抽出を1件保存し、使った粉の分だけ豆の在庫を減らす（在庫の履歴に抽出とのつながり brewId を付ける）。
 * 未開封の豆なら開封済みにする。豆を選んでいなければ在庫は変えない。
 * まだ次の抽出がない提案（この抽出で使った提案と、同じ豆の提案）に、この抽出をつなぐ。
 * @param {object} fields buildBrew（js/core/brews.js）で作った中身
 * @returns {Promise<{brew: object, tx: object|null}>}
 */
export async function saveBrew(db, fields, now = new Date()) {
  const brew = createRecord(fields, now);
  let tx = null;
  const tables = ['beans', 'inventoryTx', 'brews', 'suggestions', 'frozenPortions'].map((n) => db.table(n));
  await db.transaction('rw', tables, async () => {
    await db.table('brews').put(brew);
    // 提案ログに「採用したか」と「次の抽出」を書く（自己較正と実績の表示に使う）
    const links = linkSuggestions(await db.table('suggestions').toArray(), brew);
    for (const link of links) {
      const s = await db.table('suggestions').get(link.id);
      await db.table('suggestions').put(updateRecord(s, { adopted: link.adopted, nextBrewId: link.nextBrewId }, now));
    }
    const doseG = brew.actual?.doseG;
    if (!brew.beanId || !(doseG > 0)) return;
    const bean = await db.table('beans').get(brew.beanId);
    if (!bean || !alive(bean)) return;
    // 冷凍の袋を使ったとき：先に袋を取り出して常温に戻し、そこから粉量を引く
    if (brew.frozenPortionId) {
      const p = await db.table('frozenPortions').get(brew.frozenPortionId);
      if (p && isInFreezer(p) && p.beanId === bean.id) await takeOut(db, p, { at: brew.at, brewId: brew.id }, now);
    }
    tx = await addInventoryTx(db, { beanId: bean.id, deltaG: -doseG, kind: 'brew', brewId: brew.id, at: brew.at }, now);
    if (bean.status === 'unopened') await db.table('beans').put(updateRecord(bean, { status: 'open' }, now));
  });
  return { brew, tx };
}

/** 抽出を1件読む。ない・削除済みなら null */
export async function getBrew(db, id) {
  const b = await db.table('brews').get(id);
  return b && alive(b) ? b : null;
}

/** 削除の印が付いていない抽出の一覧 */
export async function listBrews(db) {
  return (await db.table('brews').toArray()).filter(alive);
}

/** あとから TDS（A8）を入れる・消す（null で消す）。抽出の記録の actual.tdsPct だけを書き換える */
export async function setBrewTds(db, brewId, tdsPct, now = new Date()) {
  const b = await getBrew(db, brewId);
  if (!b) throw new Error('抽出が見つかりません');
  const next = updateRecord(b, { actual: withTds(b, tdsPct) }, now);
  await db.table('brews').put(next);
  return next;
}

/**
 * あとから天気（X16）を入れる。context.weather だけを足し、すでに天気のある杯・削除した杯は変えない
 * @param {{id:string, weather:object}[]} targets js/core/weather.js の fillTargets
 * @returns {Promise<number>} 入れた杯の数
 */
export async function setBrewWeather(db, targets = [], now = new Date()) {
  if (!targets.length) return 0;
  let n = 0;
  await db.transaction('rw', db.table('brews'), async () => {
    for (const t of targets) {
      const b = await db.table('brews').get(t.id);
      if (!b || !alive(b) || b.context?.weather) continue;
      await db.table('brews').put(updateRecord(b, { context: withWeather(b, t.weather) }, now));
      n++;
    }
  });
  return n;
}

/** いちばん新しい抽出。なければ null */
export async function getLastBrew(db) {
  const list = await db.table('brews').orderBy('at').reverse().toArray();
  return list.find(alive) ?? null;
}

// ---- 味の評価（B1〜B5） ----

/** 削除の印が付いていない評価の一覧 */
export async function listTastings(db) {
  return (await db.table('tastings').toArray()).filter(alive);
}

/** その抽出の「自分」の評価（温度帯を省くと主な評価＝温かいうち）。なければ null */
export async function getTastingForBrew(db, brewId, stage = DEFAULT_STAGE) {
  return pickTasting(await db.table('tastings').where('brewId').equals(brewId).toArray(), brewId, stage);
}

/** その抽出の温度帯ごとの評価 { hot, warm, cool } */
export async function getTastingsByStage(db, brewId) {
  return tastingsByStage(await db.table('tastings').where('brewId').equals(brewId).toArray(), brewId);
}

/**
 * 抽出の評価を保存する。同じ温度帯の評価がすでにあればその1件を直す（1杯・1温度帯につき1件のまま）。
 * @param {object} value normalizeTastingInput の value
 * @param {Date} [now]
 * @param {{stage?: string}} [opts] 温度帯（B5）。省くと温かいうち
 * @returns {Promise<object>} 保存した評価
 */
export async function saveTasting(db, brewId, value, now = new Date(), { stage = DEFAULT_STAGE } = {}) {
  let saved;
  await db.transaction('rw', db.table('brews'), db.table('tastings'), async () => {
    const brew = await db.table('brews').get(brewId);
    if (!brew || !alive(brew)) throw new Error('抽出の記録が見つかりません');
    const fields = buildTasting({ brewId, value, stage });
    const cur = pickTasting(await db.table('tastings').where('brewId').equals(brewId).toArray(), brewId, fields.stage);
    // 飲み比べ（X27）で付けた評価を評価の画面で直しても、ブラインドだったことは残す
    if (cur) Object.assign(fields, { blind: cur.blind === true, experimentId: cur.experimentId ?? null });
    saved = cur ? updateRecord(cur, fields, now) : createRecord(fields, now);
    await db.table('tastings').put(saved);
  });
  return saved;
}

/** 評価がまだの抽出のうち、直近24時間でいちばん新しいもの。なければ null */
export async function getUnratedBrew(db, now = new Date()) {
  const [brews, tastings] = await Promise.all([db.table('brews').toArray(), db.table('tastings').toArray()]);
  return pickUnratedBrew(brews, tastings, now);
}

/** 冷めた味の評価を促す抽出（B5）。なければ null */
export async function getCoolPromptBrew(db, now = new Date()) {
  const [brews, tastings] = await Promise.all([db.table('brews').toArray(), db.table('tastings').toArray()]);
  return pickCoolPrompt(brews, tastings, now);
}

// ---- 気になる豆（F6） ----

/** 気になる豆の一覧（削除の印が付いたものは除く） */
export async function listWishlist(db) {
  return (await db.table('wishlist').toArray()).filter(alive);
}

/** 気になる豆1件。ない・削除済みなら null */
export async function getWish(db, id) {
  const w = await db.table('wishlist').get(id);
  return w && alive(w) ? w : null;
}

/** 気になる豆を足す（fields は core/wishlist.js の normalizeWishInput の value） */
export async function addWish(db, fields, now = new Date()) {
  const rec = createRecord({ ...fields, boughtBeanId: null }, now);
  await db.table('wishlist').put(rec);
  return rec;
}

/** 気になる豆を直す */
export async function updateWish(db, id, changes, now = new Date()) {
  const cur = await getWish(db, id);
  if (!cur) throw new Error('気になる豆が見つかりません');
  const next = updateRecord(cur, changes, now);
  await db.table('wishlist').put(next);
  return next;
}

/** 気になる豆を消す（削除の印） */
export async function deleteWish(db, id, now = new Date()) {
  const cur = await getWish(db, id);
  if (cur) await db.table('wishlist').put(markDeleted(cur, now));
}

// ---- 飲み比べ・実験（X27・F7・B6） ----

/** 飲み比べの一覧（削除の印が付いたものは除く） */
export async function listExperiments(db) {
  return (await db.table('experiments').toArray()).filter(alive);
}

/** 飲み比べ1件。ない・削除済みなら null */
export async function getExperiment(db, id) {
  const e = await db.table('experiments').get(id);
  return e && alive(e) ? e : null;
}

/** 飲み比べを始める（fields は core/compare.js の buildExperiment） */
export async function addExperiment(db, fields, now = new Date()) {
  const rec = createRecord(fields, now);
  await db.table('experiments').put(rec);
  return rec;
}

/** 飲み比べの一部を変える（カップの評価など） */
export async function updateExperiment(db, id, changes, now = new Date()) {
  const cur = await getExperiment(db, id);
  if (!cur) throw new Error('飲み比べが見つかりません');
  const next = updateRecord(cur, changes, now);
  await db.table('experiments').put(next);
  return next;
}

/** 飲み比べをやめる（削除の印。淹れた抽出と評価は残す） */
export async function deleteExperiment(db, id, now = new Date()) {
  const cur = await getExperiment(db, id);
  if (cur) await db.table('experiments').put(markDeleted(cur, now));
}

/**
 * 飲み比べで淹れた抽出をつなぐ（抽出の保存のすぐあと）
 * @param {{brewId:string, beanId:string|null, targetBeanId?:string|null}} p
 */
export async function attachBrewToExperiment(db, id, p, now = new Date()) {
  const cur = await getExperiment(db, id);
  // 結果を出したあとの飲み比べにはつながない（古い画面から淹れ直しても、結果の杯を置き換えない、2-8の50番）
  if (!cur || cur.revealedAt) return null;
  return updateExperiment(db, id, { entries: attachBrew(cur, p) }, now);
}

/**
 * 結果を出す：カップの評価（答え合わせ済み）を残し、それぞれの抽出の「温かいうち」の評価として保存する。
 * すでに評価があればその1件を直す。ブラインドで評価したことと、どの飲み比べかを評価に残す。
 * @param {object[]} ratings beanId の入ったカップの評価（ブラインドなら core/compare.js の reveal の結果）
 */
export async function finishExperiment(db, id, ratings, now = new Date()) {
  let saved;
  await db.transaction('rw', db.table('experiments'), db.table('brews'), db.table('tastings'), async () => {
    const cur = await getExperiment(db, id);
    if (!cur) throw new Error('飲み比べが見つかりません');
    saved = updateRecord(cur, { ratings, revealedAt: new Date(now).toISOString() }, now);
    await db.table('experiments').put(saved);
    for (const t of tastingsToSave(saved)) {
      const brew = await db.table('brews').get(t.brewId);
      if (!brew || !alive(brew)) continue;
      const { value } = normalizeTastingInput(t.value, { allowEmpty: true });
      const fields = buildTasting({ brewId: t.brewId, value, blind: cur.blind !== false, experimentId: cur.id });
      const old = pickTasting(await db.table('tastings').where('brewId').equals(t.brewId).toArray(), t.brewId);
      // 評価の画面で入れた詳細評価・香味などは残し、★・一言・メモだけを飲み比べの評価にする
      const merged = old ? { ...fields, jar: old.jar ?? fields.jar, intensity: old.intensity ?? fields.intensity, liking: old.liking ?? fields.liking, flavors: old.flavors ?? fields.flavors, defects: old.defects ?? fields.defects } : fields;
      await db.table('tastings').put(old ? updateRecord(old, merged, now) : createRecord(merged, now));
    }
  });
  return saved;
}

/**
 * トライアングルテスト（B6）の答え合わせを残す。評価の記録は作らない（淹れた杯は、評価の画面でふつうに評価できる）
 * @param {{picked:number, odd:number, correct:boolean, liked:string|null}} answer core/experiment-plan.js の judgeTriangle の answer
 */
export async function finishTriangle(db, id, answer, now = new Date()) {
  return updateExperiment(db, id, { answer: { ...answer }, revealedAt: new Date(now).toISOString() }, now);
}

/** 最適化（F7）を終える／続ける（終えると一覧の「これまで」に移る） */
export async function setOptimizeDone(db, id, done, now = new Date()) {
  return updateExperiment(db, id, { revealedAt: done ? new Date(now).toISOString() : null }, now);
}

// ---- 写真（A7） ----

/** その抽出の枠ごとの写真 { grounds, bed, liquid } */
export async function getPhotosForBrew(db, brewId) {
  return photosOfBrew(await db.table('photos').where('brewId').equals(brewId).toArray(), brewId);
}

/** 削除の印を付けて画像の文字を消す（端末の容量を空ける） */
const erasePhoto = (p, now) => ({ ...markDeleted(p, now), dataUrl: null, bytes: 0 });

/**
 * 写真を保存する。同じ抽出・同じ枠の写真があれば、それを消して置き換える。
 * @param {{brewId:string, slot:string, dataUrl:string, widthPx:number, heightPx:number}} input
 * @returns {Promise<object>} 保存した写真
 */
export async function savePhoto(db, input, now = new Date()) {
  const fields = buildPhoto(input);
  let saved;
  await db.transaction('rw', db.table('brews'), db.table('photos'), async () => {
    const brew = await db.table('brews').get(fields.brewId);
    if (!brew || !alive(brew)) throw new Error('抽出の記録が見つかりません');
    const old = (await db.table('photos').where('brewId').equals(fields.brewId).toArray()).filter((p) => alive(p) && p.slot === fields.slot);
    if (old.length) await db.table('photos').bulkPut(old.map((p) => erasePhoto(p, now)));
    saved = createRecord(fields, now);
    await db.table('photos').put(saved);
  });
  return saved;
}

/** 写真を消す（削除の印を付け、画像の文字も消す） */
export async function deletePhoto(db, id, now = new Date()) {
  const p = await db.table('photos').get(id);
  if (!p || !alive(p)) return null;
  const next = erasePhoto(p, now);
  await db.table('photos').put(next);
  return next;
}

// ---- ダイヤルイン提案（F1） ----

/** 提案1件。ない・削除済みなら null */
export async function getSuggestion(db, id) {
  const s = await db.table('suggestions').get(id);
  return s && alive(s) ? s : null;
}

/** その抽出の提案。なければ null */
export async function getSuggestionForBrew(db, brewId) {
  return pickSuggestionForBrew(await db.table('suggestions').where('brewId').equals(brewId).toArray(), brewId);
}

/** 削除の印が付いていない提案の一覧 */
export async function listSuggestions(db) {
  return (await db.table('suggestions').toArray()).filter(alive);
}

/**
 * 抽出の評価から次の1杯の提案を作り、提案ログに保存する（1杯につき1件。評価を直したら作り直す）。
 * すでに次の抽出に使った提案は、結果の記録なので作り直さずにそのまま返す。
 * 判断する材料がなければ、まだ使っていない提案を消して null を返す。
 * @returns {Promise<object|null>} 保存した提案
 */
export async function saveSuggestionForBrew(db, brewId, now = new Date()) {
  const tables = ['brews', 'tastings', 'recipes', 'equipment', 'suggestions'].map((n) => db.table(n));
  let saved = null;
  await db.transaction('rw', tables, async () => {
    const brew = await db.table('brews').get(brewId);
    if (!brew || !alive(brew)) throw new Error('抽出の記録が見つかりません');
    const tastings = await db.table('tastings').toArray();
    const tasting = pickTasting(tastings, brewId);
    const suggestions = (await db.table('suggestions').toArray()).filter(alive);
    const cur = pickSuggestionForBrew(suggestions, brewId);
    if (cur?.nextBrewId) {
      saved = cur;
      return;
    }
    const recipe = brew.recipeId ? await db.table('recipes').get(brew.recipeId) : null;
    const plan = basePlanForNext(brew, recipe);
    const grinder = plan.grind?.grinderId ? await db.table('equipment').get(plan.grind.grinderId) : null;
    const step = parseNumber(grinder?.attrs?.step);
    const result = tasting
      ? suggestNext({
          tasting,
          plan,
          grindStep: step > 0 ? step : undefined,
          beanId: brew.beanId ?? null,
          suggestions: suggestions.filter((s) => s.brewId !== brewId),
          tastings,
        })
      : null;
    if (!result) {
      if (cur) await db.table('suggestions').put(markDeleted(cur, now));
      return;
    }
    const fields = buildSuggestion({ brew, tasting, suggestion: result });
    saved = cur ? updateRecord(cur, fields, now) : createRecord(fields, now);
    await db.table('suggestions').put(saved);
  });
  return saved;
}
