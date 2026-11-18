// 自動ファイル保存（X1）：PC の Chrome・Edge の「フォルダを選んで書き込む」機能（File System Access）を使う
// 選んだフォルダの情報（ハンドル）は書き出しに入れられないので、本体とは別の小さな保存場所（pourfolio-local）に置く（D-140）。
// 使えないブラウザ（iPhone・Android・Firefox など）では何もしない。
import { exportAll, updateSettings } from './db.js';
import { AUTOSAVE_FILE_NAME, AUTOSAVE_WAIT_MS, autosaveStatus, hasRecordsToSave } from './core/autosave.js';

const LOCAL_DB = 'pourfolio-local';
const STORE = 'kv';

/** このブラウザで使えるか（PC の Chrome・Edge） */
export const autosaveSupported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

function openLocal() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kv(mode, fn) {
  const db = await openLocal();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const getLocal = (key) => kv('readonly', (s) => s.get(key));
const setLocal = (key, value) => kv('readwrite', (s) => s.put(value, key));
const delLocal = (key) => kv('readwrite', (s) => s.delete(key));

async function permissionOf(handle) {
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'prompt';
  }
}

/** 今の状態（画面に出す文つき） */
export async function getAutosaveState() {
  if (!autosaveSupported()) return autosaveStatus({ supported: false });
  const [handle, lastAt, lastError] = await Promise.all([getLocal('dir'), getLocal('lastAt'), getLocal('lastError')]);
  return autosaveStatus({ supported: true, folderName: handle?.name ?? null, permission: handle ? await permissionOf(handle) : null, lastAt: lastAt ?? null, lastError: lastError ?? null });
}

async function writeNow(db, handle) {
  const now = new Date();
  const backup = await exportAll(db, now);
  if (!hasRecordsToSave(backup.tables)) {
    // 記録が空のときは上書きしない（全部消したあとに、唯一のバックアップを空にしないように。2-8 の18番）
    await setLocal('lastError', '記録が空なので上書きしていません');
    return;
  }
  const file = await handle.getFileHandle(AUTOSAVE_FILE_NAME, { create: true });
  const w = await file.createWritable();
  await w.write(JSON.stringify(backup, null, 1));
  await w.close();
  await setLocal('lastAt', now.toISOString());
  await delLocal('lastError');
  // ファイルに残ったので、書き出しの促し（G2）を出さないようにする
  await updateSettings(db, { lastBackupAt: now.toISOString() }, now);
}

/** フォルダを選んで、すぐ1回保存する（ボタンを押したときに呼ぶ） */
export async function chooseFolder(db) {
  const handle = await window.showDirectoryPicker({ id: 'pourfolio-backup', mode: 'readwrite' });
  await setLocal('dir', handle);
  await writeNow(db, handle);
}

/** 止まっていた自動保存を再開する（許可を聞くので、ボタンを押したときに呼ぶ） */
export async function resumeAutosave(db) {
  const handle = await getLocal('dir');
  if (!handle) return false;
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
  await writeNow(db, handle);
  return true;
}

/** 自動保存をやめる（フォルダの中のファイルは消さない） */
export async function stopAutosave() {
  await Promise.all([delLocal('dir'), delLocal('lastAt'), delLocal('lastError')]);
}

/**
 * 保存したあとに呼ぶ。許可があるときだけ書き、失敗しても記録の保存は止めない。
 * 画面を移る前に呼ぶので、AUTOSAVE_WAIT_MS より長くは待たない。
 */
export async function autosaveAfterChange(db) {
  if (!autosaveSupported()) return;
  const job = (async () => {
    const handle = await getLocal('dir');
    if (!handle || (await permissionOf(handle)) !== 'granted') return;
    try {
      await writeNow(db, handle);
    } catch (err) {
      console.error(err);
      await setLocal('lastError', err?.name === 'NotFoundError' ? 'フォルダが見つかりません' : '書き込みに失敗');
    }
  })().catch((err) => console.error(err));
  await Promise.race([job, new Promise((r) => setTimeout(r, AUTOSAVE_WAIT_MS))]);
}
