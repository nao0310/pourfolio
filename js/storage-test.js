// 保存テスト画面：IndexedDB に値を1件保存し、閉じても残るかを確かめる。
// 本番のデータベースとは別の名前を使う（ステップ 1-1 の Dexie とぶつからないように）。
import { formatDateTimeJa } from './core/format.js';
import { isStandalone, registerServiceWorker, requestPersistentStorage } from './pwa.js';

const DB_NAME = 'pourfolio-storage-test';
const STORE = 'kv';
const KEY = 'test';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const getRecord = () => run('readonly', (s) => s.get(KEY));
const putRecord = (rec) => run('readwrite', (s) => s.put(rec));
const deleteRecord = () => run('readwrite', (s) => s.delete(KEY));

const $ = (id) => document.getElementById(id);

async function render() {
  const rec = await getRecord();
  $('saved').textContent = rec ? rec.value : '（まだ保存されていません）';
  $('savedAt').textContent = rec ? `保存した日時：${formatDateTimeJa(rec.updatedAt)}` : '';
}

async function showStatus() {
  $('mode').textContent = isStandalone() ? 'ホーム画面のアプリ' : 'ブラウザ';
  const p = await requestPersistentStorage();
  $('persist').textContent = p === null ? 'この端末は非対応' : p ? '有効' : '無効（ホーム画面に追加すると消されにくくなります）';
  if (navigator.storage?.estimate) {
    const { usage = 0 } = await navigator.storage.estimate();
    $('usage').textContent = `${Math.round(usage / 1024)} KB`;
  }
}

$('save').addEventListener('click', async () => {
  const value = $('input').value.trim();
  if (!value) {
    $('msg').textContent = '値を入力してください';
    return;
  }
  const now = new Date().toISOString();
  const prev = await getRecord();
  await putRecord({ key: KEY, value, createdAt: prev?.createdAt ?? now, updatedAt: now, deletedAt: null });
  $('input').value = '';
  $('msg').textContent = '保存しました。アプリを閉じて開き直してみてください。';
  await render();
});

$('clear').addEventListener('click', async () => {
  await deleteRecord();
  $('msg').textContent = '消しました';
  await render();
});

registerServiceWorker();
render().catch((err) => {
  $('saved').textContent = '読み込めませんでした。開き直してください';
  console.error(err);
});
showStatus();
