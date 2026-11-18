// 書き出し（バックアップ）と復元の中身（純粋関数）
// ファイル形式：{ app, formatVersion, exportedAt, tables: { 表の名前: [記録, …] } }

import { TABLES } from './records.js';

export const APP_ID = 'pourfolio';
/** 書き出しファイルの形式の版。形式を変えたら上げて、MIGRATIONS に移行処理を足す */
export const FORMAT_VERSION = 1;

/**
 * 古い形式のファイルを1つ新しい版に直す処理。
 * キーは「直す前の版」。例：{ 1: (b) => ({ ...b, formatVersion: 2, … }) }
 */
export const MIGRATIONS = Object.freeze({});

/** 復元できないファイルのときのエラー（message はそのまま画面に出せる日本語） */
export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * 書き出す中身を作る。全部の表を必ず含める（空なら空の配列）。
 * @param {Record<string, object[]>} tables
 * @param {Date|string|number} [now]
 */
export function makeBackup(tables, now = new Date()) {
  const out = {};
  for (const name of TABLES) out[name] = [...(tables[name] ?? [])];
  return {
    app: APP_ID,
    formatVersion: FORMAT_VERSION,
    exportedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    tables: out,
  };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 書き出しファイルの名前（例：pourfolio-backup-20261118-0742.json） */
export function backupFileName(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const ymd = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  return `${APP_ID}-backup-${ymd}-${pad2(d.getHours())}${pad2(d.getMinutes())}.json`;
}

/** 表ごとの件数 { beans: 3, … } */
export function countRecords(tables) {
  const counts = {};
  for (const name of TABLES) counts[name] = (tables[name] ?? []).length;
  return counts;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 書き出しファイル（文字列かオブジェクト）を検査し、今の形式に直して返す。
 * 復元できないときは BackupError を投げる。
 * @param {string|object} input
 * @param {{ migrations?: object, currentVersion?: number }} [options] テスト用に差し替えられる
 */
export function parseBackup(input, { migrations = MIGRATIONS, currentVersion = FORMAT_VERSION } = {}) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new BackupError('ファイルを読み取れませんでした（JSONの形になっていません）');
    }
  }
  if (!isPlainObject(data) || data.app !== APP_ID) {
    throw new BackupError('Pourfolioの書き出しファイルではありません');
  }
  const version = data.formatVersion;
  if (!Number.isInteger(version) || version < 1) {
    throw new BackupError('ファイルの形式の版が分かりません');
  }
  if (version > currentVersion) {
    throw new BackupError('新しい版のアプリで作られたファイルです。アプリを最新にしてから復元してください');
  }

  for (let v = version; v < currentVersion; v++) {
    const migrate = migrations[v];
    if (!migrate) throw new BackupError(`版${v}のファイルを今の形式に直す方法がありません`);
    data = migrate(data);
  }

  if (!isPlainObject(data.tables)) {
    throw new BackupError('ファイルに記録が入っていません');
  }
  const tables = {};
  for (const name of TABLES) {
    const rows = data.tables[name] ?? [];
    if (!Array.isArray(rows)) throw new BackupError(`「${name}」の中身が壊れています`);
    rows.forEach((row, i) => {
      if (!isPlainObject(row) || typeof row.id !== 'string' || row.id === '') {
        throw new BackupError(`「${name}」の${i + 1}件目にIDがありません`);
      }
    });
    tables[name] = rows;
  }
  return { ...data, formatVersion: currentVersion, tables };
}

const time = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * 今ある記録と、ファイルの記録を統合する。同じIDなら updatedAt が新しいほうを残す。
 * ファイルにしかない記録は足し、今にしかない記録はそのまま残す。
 * @param {object[]} existing 今ある記録（同じIDのものだけ渡せばよい）
 * @param {object[]} incoming ファイルの記録
 * @returns {{ toPut: object[], added: number, updated: number, skipped: number }}
 */
export function mergeRecords(existing, incoming) {
  const byId = new Map(existing.filter(Boolean).map((r) => [r.id, r]));
  const toPut = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const rec of incoming) {
    const cur = byId.get(rec.id);
    if (!cur) {
      added++;
    } else if (time(rec.updatedAt) > time(cur.updatedAt)) {
      updated++;
    } else {
      skipped++;
      continue;
    }
    toPut.push(rec);
    byId.set(rec.id, rec);
  }
  return { toPut, added, updated, skipped };
}
