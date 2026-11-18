// 端末内のデータベース（IndexedDB を Dexie で扱う）
// 計算や判定は js/core/ に置き、ここは出し入れだけにする。

import Dexie from '../vendor/dexie/dexie.mjs';
import { TABLES, SETTINGS_ID, createRecord, updateRecord, markDeleted } from './core/records.js';
import { initialStockG } from './core/roast.js';
import { remainingG, adjustDelta } from './core/inventory.js';
import { makeBackup, mergeRecords } from './core/backup.js';
import { buildTasting, pickTasting, pickUnratedBrew } from './core/tastings.js';

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
      const { toPut, added, updated, skipped } = mergeRecords(existing, incoming);
      if (toPut.length) await table.bulkPut(toPut);
      result[name] = { added, updated, skipped };
    }
  });
  return result;
}

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

/** 設定（1件）を読む。なければ作って返す */
export async function getSettings(db, now = new Date()) {
  const cur = await db.table('settings').get(SETTINGS_ID);
  if (cur) return cur;
  const rec = createRecord({ id: SETTINGS_ID, lastBackupAt: null }, now);
  await db.table('settings').put(rec);
  return rec;
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

/** 豆1つと、その在庫履歴（削除の印が付いたものは除く）。豆がない・削除済みなら null */
export async function getBeanWithTx(db, beanId) {
  const bean = await db.table('beans').get(beanId);
  if (!bean || !alive(bean)) return null;
  const txs = (await db.table('inventoryTx').where('beanId').equals(beanId).toArray()).filter(alive);
  return { bean, txs };
}

/**
 * 入庫の履歴を、豆の重量の入力に合わせる（なければ作る、量がなければ削除の印を付ける）。
 * 豆の登録と、編集で重量を直したときに使う。量り直しの履歴があれば入庫の量は変えない。
 */
async function syncInboundTx(db, bean, now) {
  const allBeans = await db.table('beans').toArray();
  const stock = initialStockG(bean, allBeans);
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
    await syncInboundTx(db, next, now);
  });
  return next;
}

/** 豆の状態だけを変える（未開封・開封済み・飲み切り） */
export async function setBeanStatus(db, beanId, status, now = new Date()) {
  const cur = await db.table('beans').get(beanId);
  if (!cur || !alive(cur)) throw new Error('豆が見つかりません');
  const next = updateRecord(cur, { status }, now);
  await db.table('beans').put(next);
  return next;
}

/** 豆を削除する（豆と在庫履歴に削除の印を付ける） */
export async function deleteBean(db, beanId, now = new Date()) {
  await db.transaction('rw', db.table('beans'), db.table('inventoryTx'), async () => {
    const cur = await db.table('beans').get(beanId);
    if (cur && alive(cur)) await db.table('beans').put(markDeleted(cur, now));
    const txs = (await db.table('inventoryTx').where('beanId').equals(beanId).toArray()).filter(alive);
    if (txs.length) await db.table('inventoryTx').bulkPut(txs.map((t) => markDeleted(t, now)));
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

/** 在庫履歴1件を取り消す（削除の印を付ける） */
export async function deleteInventoryTx(db, txId, now = new Date()) {
  const cur = await db.table('inventoryTx').get(txId);
  if (cur && alive(cur)) await db.table('inventoryTx').put(markDeleted(cur, now));
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
  const cur = await db.table('equipment').get(id);
  if (cur && alive(cur)) await db.table('equipment').put(markDeleted(cur, now));
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
 * @param {object} fields buildBrew（js/core/brews.js）で作った中身
 * @returns {Promise<{brew: object, tx: object|null}>}
 */
export async function saveBrew(db, fields, now = new Date()) {
  const brew = createRecord(fields, now);
  let tx = null;
  await db.transaction('rw', db.table('beans'), db.table('inventoryTx'), db.table('brews'), async () => {
    await db.table('brews').put(brew);
    const doseG = brew.actual?.doseG;
    if (!brew.beanId || !(doseG > 0)) return;
    const bean = await db.table('beans').get(brew.beanId);
    if (!bean || !alive(bean)) return;
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

/** いちばん新しい抽出。なければ null */
export async function getLastBrew(db) {
  const list = await db.table('brews').orderBy('at').reverse().toArray();
  return list.find(alive) ?? null;
}

// ---- 味の評価（B1・B2） ----

/** その抽出の「自分・温かいうち」の評価。なければ null */
export async function getTastingForBrew(db, brewId) {
  return pickTasting(await db.table('tastings').where('brewId').equals(brewId).toArray(), brewId);
}

/**
 * 抽出の評価を保存する。すでにあればその1件を直す（1杯につき1件のまま）。
 * @param {object} value normalizeTastingInput の value
 * @returns {Promise<object>} 保存した評価
 */
export async function saveTasting(db, brewId, value, now = new Date()) {
  let saved;
  await db.transaction('rw', db.table('brews'), db.table('tastings'), async () => {
    const brew = await db.table('brews').get(brewId);
    if (!brew || !alive(brew)) throw new Error('抽出の記録が見つかりません');
    const fields = buildTasting({ brewId, value });
    const cur = pickTasting(await db.table('tastings').where('brewId').equals(brewId).toArray(), brewId);
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
