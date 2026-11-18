// QRコード（X10・X14）：文字から QR の模様を作り、SVG の形にする（純粋関数）
// 作るのは同梱の qrcode-generator（vendor/、D-137）。読み取りは iPhone 標準のカメラに任せる。

import qrcode from '../../vendor/qrcode-generator/qrcode.mjs';

/**
 * QR の模様（true が黒）。大きさは中身に合わせて自動で選ぶ。
 * @param {string} text
 * @param {'L'|'M'|'Q'|'H'} [ecc] 誤り訂正。M は 約15% 汚れても読める
 * @returns {boolean[][]}
 */
export function qrModules(text, ecc = 'M') {
  const qr = qrcode(0, ecc);
  qr.addData(String(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * SVG の文字（黒い四角を1本の path にまとめる）。まわりに4マスの余白（読み取りに必要）。
 * 色は白地に黒で固定（ダーク表示でもカメラが読めるように）。
 */
export function qrSvg(text, { ecc = 'M', label = 'QRコード' } = {}) {
  const m = qrModules(text, ecc);
  const quiet = 4;
  const size = m.length + quiet * 2;
  let d = '';
  m.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (dark) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    });
  });
  const esc = String(label).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${esc}"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}
