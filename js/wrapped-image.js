// 年間まとめ（X5）の1枚画像を canvas に描く（中身は js/core/wrapped.js の wrappedImageContent）
// 抽出レポートの画像（X3）と同じく、ダーク表示に関係なく明るい紙の色で描く。
import { C, roundRect, text, setJa } from './brew-image.js';
import { IMAGE_W, IMAGE_H } from './core/report-image.js';

/**
 * @param {ReturnType<import('./core/wrapped.js').wrappedImageContent>} c
 * @returns {HTMLCanvasElement}
 */
export function drawWrappedImage(c) {
  const cv = document.createElement('canvas');
  cv.width = IMAGE_W;
  cv.height = IMAGE_H;
  const ctx = setJa(cv.getContext('2d'));
  const M = 64;
  const W = IMAGE_W - M * 2;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, IMAGE_W, IMAGE_H);

  // 見出しの帯
  ctx.fillStyle = C.accent;
  roundRect(ctx, M, M, W, 260, 28);
  ctx.fill();
  text(ctx, 'Pourfolio  Coffee Wrapped', M + 40, M + 70, { px: 32, weight: 700, color: '#fbe9d6' });
  text(ctx, c.title, M + 40, M + 170, { px: 84, weight: 700, color: '#ffffff', maxW: W - 80 });
  text(ctx, c.period, M + 40, M + 225, { px: 32, color: '#fbe9d6', maxW: W - 80 });

  // 数字のマス（3列×2段）
  let y = M + 300;
  const cols = 3;
  const gap = 18;
  const cellW = (W - gap * (cols - 1)) / cols;
  const cellH = 150;
  c.stats.forEach((s, i) => {
    const x = M + (i % cols) * (cellW + gap);
    const yy = y + Math.floor(i / cols) * (cellH + gap);
    ctx.fillStyle = C.card;
    roundRect(ctx, x, yy, cellW, cellH, 20);
    ctx.fill();
    text(ctx, s.label, x + 24, yy + 48, { px: 28, color: C.muted, maxW: cellW - 48 });
    text(ctx, s.value, x + 24, yy + 112, { px: 52, weight: 700, maxW: cellW - 48 });
  });
  y += Math.ceil(c.stats.length / cols) * (cellH + gap) + 12;

  // 1行ずつの項目
  for (const l of c.lines) {
    ctx.fillStyle = C.card;
    roundRect(ctx, M, y, W, 150, 20);
    ctx.fill();
    text(ctx, l.label, M + 28, y + 48, { px: 28, color: C.muted, maxW: W - 56 });
    text(ctx, l.value, M + 28, y + 110, { px: 50, weight: 700, maxW: l.note ? W * 0.6 : W - 56 });
    if (l.note) text(ctx, l.note, M + W - 28, y + 110, { px: 28, color: C.muted, align: 'right', maxW: W * 0.36 });
    y += 168;
  }
  return cv;
}
