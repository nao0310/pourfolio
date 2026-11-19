// 保存の失敗の見分け方（純粋関数、総仕上げの61番）
// Dexie は IndexedDB の失敗を包むので（AbortError の inner など）、中まで見る

/** 端末の保存の空きが足りなくて失敗したか */
export function isQuotaError(err) {
  for (let e = err, i = 0; e && i < 5; e = e.inner ?? e.cause, i++) {
    if (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message ?? ''))) return true;
  }
  return false;
}

/** 空きが足りないときの文 */
export const QUOTA_TEXT = '端末の保存の空きが足りません。写真やほかのアプリのデータを減らして空きを作ってから、もう一度押してください';
