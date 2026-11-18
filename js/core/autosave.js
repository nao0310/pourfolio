// 自動ファイル保存（X1、PCの Chrome・Edge だけ）：決めたフォルダのバックアップファイルを、保存のたびに上書きする（純粋関数）
// 書き出しの中身は「書き出す」と同じ（写真も入る）。Googleドライブなどの同期フォルダを選べば無料のクラウドバックアップになる。

import { formatDateTimeJa } from './format.js';

/** 上書きするファイルの名前（日付を入れず、いつも同じ1つ） */
export const AUTOSAVE_FILE_NAME = 'pourfolio-backup.json';
/** 保存を待つ長さの上限（ミリ秒）。画面を移る前に待ちすぎないように */
export const AUTOSAVE_WAIT_MS = 2000;

/**
 * データの画面とホームに出す状態
 * @param {{supported:boolean, folderName?:string|null, permission?:'granted'|'prompt'|'denied'|null, lastAt?:string|null, lastError?:string|null}} p
 * @returns {{show:boolean, on:boolean, needsPermission:boolean, text:string}}
 */
export function autosaveStatus({ supported, folderName = null, permission = null, lastAt = null, lastError = null }) {
  if (!supported) return { show: false, on: false, needsPermission: false, text: '' };
  if (!folderName) return { show: true, on: false, needsPermission: false, text: 'まだフォルダを選んでいません' };
  const last = lastAt ? `最後に保存：${formatDateTimeJa(lastAt)}` : 'まだ保存していません';
  if (permission === 'denied') return { show: true, on: false, needsPermission: true, text: `「${folderName}」に書き込む許可がありません。フォルダを選び直してください` };
  if (permission !== 'granted') return { show: true, on: true, needsPermission: true, text: `「${folderName}」への自動保存は止まっています（ブラウザを開き直したため）。「再開する」を押してください。${last}` };
  if (lastError) return { show: true, on: true, needsPermission: false, text: `「${folderName}」に保存できませんでした（${lastError}）。${last}` };
  return { show: true, on: true, needsPermission: false, text: `「${folderName}」の ${AUTOSAVE_FILE_NAME} に、保存のたびに上書きします。${last}` };
}

/**
 * 書き出しの中身に、上書きしてよい記録があるか（2-8 の18番）。
 * 全部消したあとなど、記録が1件もない（設定だけ）の中身でフォルダのファイルを上書きしない。
 * そのファイルが唯一のバックアップのことがあるため
 * @param {Record<string, object[]>} tables 書き出しの tables
 */
export function hasRecordsToSave(tables) {
  return Object.entries(tables ?? {}).some(([name, rows]) => name !== 'settings' && (rows ?? []).some((r) => r && r.deletedAt == null));
}
