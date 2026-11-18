// 写真（A7）の画面側の処理：選んだ写真を縮小して JPEG の data URL にする（DOMを使うので js/core/ には置かない）
// iPhone で「写真を撮る」「写真ライブラリ」から選んだ HEIC は、Safari が JPEG に直して渡してくれる。
import { fitSize, PHOTO_MAX_EDGE, PHOTO_QUALITY } from './core/photos.js';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = url;
  });
}

/**
 * 写真のファイルを縮小する（長い辺 1280px・JPEG）。写真の向き（縦横）はブラウザが直した向きのまま
 * @param {File} file
 * @returns {Promise<{dataUrl:string, widthPx:number, heightPx:number}>}
 */
export async function shrinkImageFile(file) {
  if (!file || !String(file.type).startsWith('image/')) throw new Error('写真のファイルを選んでください');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, PHOTO_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // 透明な部分（PNG）を白にする
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL('image/jpeg', PHOTO_QUALITY), widthPx: width, heightPx: height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
