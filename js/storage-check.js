// 記録の保存場所（IndexedDB）が開けるかを確かめ、開けなければ画面の上に原因を出す（総仕上げの74番、D-179）。
// プライベートブラウズや保存の制限では、どの画面も「読み込めませんでした。開き直してください」になり、開き直しても直らないため。
// 確かめるのは別の小さな保存場所（pourfolio-probe）で、開けたらすぐ消す（記録の保存場所には触らない）。
// registerServiceWorker（js/pwa.js）から全画面で呼ばれる。
export const STORAGE_UNAVAILABLE_TITLE = 'この開き方では記録を保存できません';
export const STORAGE_UNAVAILABLE_TEXT =
  'プライベートブラウズや、ブラウザの保存の制限で、記録の保存場所が使えません。ふつうのタブか、ホーム画面に追加したアプリで開いてください。';

/** 開ければ true、開けなければ false、分からなければ null（3秒で答えがないとき） */
export function probeIndexedDb(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const done = (v) => {
      clearTimeout(timer);
      resolve(v);
    };
    try {
      if (!('indexedDB' in window) || !window.indexedDB) return done(false);
      const req = window.indexedDB.open('pourfolio-probe');
      req.onsuccess = () => {
        try {
          req.result.close();
          window.indexedDB.deleteDatabase('pourfolio-probe');
        } catch {}
        done(true);
      };
      req.onerror = () => done(false);
      req.onblocked = () => done(null);
    } catch {
      done(false);
    }
  });
}

export async function checkStorage() {
  if ((await probeIndexedDb()) !== false) return;
  const show = () => {
    if (document.getElementById('storageBar')) return;
    const bar = document.createElement('div');
    bar.id = 'storageBar';
    bar.className = 'card storage-bar';
    bar.setAttribute('role', 'alert');
    const title = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = STORAGE_UNAVAILABLE_TITLE;
    title.append(strong);
    const text = document.createElement('p');
    text.textContent = STORAGE_UNAVAILABLE_TEXT;
    bar.append(title, text);
    (document.querySelector('main') ?? document.body).prepend(bar);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
  else show();
}
