// ホーム画面アプリ（PWA）まわりの共通処理

/** ホーム画面から開いているか */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/** service worker を登録する（使えない環境では何もしない） */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
    return true;
  } catch (err) {
    console.warn('service worker の登録に失敗しました', err);
    return false;
  }
}

/** 「消されにくい保存」を要求し、結果を返す（true / false / null=非対応） */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
