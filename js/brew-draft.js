// 抽出の途中の状態（下書き）の置き場所：このブラウザの localStorage（D-038）
// 抽出が終わるまでの一時的なもので、書き出し（バックアップ）には入れない。
import { isValidDraft } from './core/brews.js';

const KEY = 'pourfolio.brewDraft';

/** 下書きを読む。ない・壊れている・古い形なら null */
export function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return isValidDraft(d) ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft) {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch (err) {
    console.warn('下書きを保存できませんでした', err);
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 使えない環境では何もしない */
  }
}
