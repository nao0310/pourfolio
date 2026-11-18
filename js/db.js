// 端末内のデータベース（IndexedDB を Dexie で扱う）
// 計算や判定は js/core/ に置き、ここは出し入れだけにする。

import Dexie from '../vendor/dexie/dexie.mjs';
import { TABLES, SETTINGS_ID, createRecord, updateRecord } from './core/records.js';
import { makeBackup, mergeRecords } from './core/backup.js';

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
