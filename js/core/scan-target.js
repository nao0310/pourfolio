// アプリの中で読んだ QR の行き先（X10・X14、D-143）（純粋関数）
// iPhone ではホーム画面のアプリと Safari で保存場所が別なので、QR はアプリの中で読み、アプリの中で開く。
// 開くのはこのアプリの画面だけ。ほかの人の Pourfolio の共有リンクは、中身だけを取り出して自分の share.html で開く。
// それ以外の URL や文字は開かずに見せるだけ（知らないサイトへ勝手に移らないため）。

import { codeFromHash } from './share-code.js';

/**
 * @param {string} text 読んだ文字
 * @param {string} appBase このアプリの場所（例 https://…/pourfolio/）
 * @returns {{kind:'app', href:string}|{kind:'share', href:string}|{kind:'other', text:string}}
 */
export function scanTarget(text, appBase) {
  const s = String(text ?? '').trim();
  let url;
  try {
    url = new URL(s);
  } catch {
    return { kind: 'other', text: s };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'other', text: s };
  const file = url.pathname.split('/').pop();
  // 共有リンク（どの端末の Pourfolio のものでも、中身だけを使う）
  if (file === 'share.html') {
    const code = codeFromHash(url.hash);
    if (code) return { kind: 'share', href: `share.html#r=${code}` };
  }
  const base = new URL(appBase);
  if (url.origin === base.origin && url.pathname.startsWith(base.pathname) && /^[a-z0-9-]*\.html$|^$/.test(file)) {
    return { kind: 'app', href: `${url.pathname.slice(base.pathname.length) || './'}${url.search}${url.hash}` };
  }
  return { kind: 'other', text: s };
}

/** キャニスターの QR の URL（その豆のいちばん★の高い杯の淹れ方で、抽出の画面を開く） */
export function canisterUrl(appBase, beanId) {
  return `${new URL('brew.html', appBase).href}?best=${encodeURIComponent(beanId)}`;
}
