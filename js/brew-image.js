// 抽出レポートの1枚画像（X3）を canvas に描いて PNG にする（中身は js/core/report-image.js）
// 色は画面のダーク表示に関係なく、いつも同じ明るい紙の色にする（SNS やアルバムで同じに見えるように）。
import { IMAGE_W, IMAGE_H, pourChart } from './core/report-image.js';
import { formatSec } from './core/recipes.js';

export const C = { bg: '#faf6f0', card: '#ffffff', fg: '#2b1d12', muted: '#7a6656', line: '#e6dccf', accent: '#8b5a34', star: '#c7871f' };
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", system-ui, sans-serif';

export const font = (px, weight = 400) => `${weight} ${px}px ${FONT}`;

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function text(ctx, s, x, y, { px = 36, weight = 400, color = C.fg, align = 'left', maxW } = {}) {
  ctx.font = font(px, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y, maxW);
}

/**
 * @param {ReturnType<import('./core/report-image.js').brewImageContent>} c
 * @returns {HTMLCanvasElement}
 */
export function drawBrewImage(c) {
  const cv = document.createElement('canvas');
  cv.width = IMAGE_W;
  cv.height = IMAGE_H;
  const ctx = cv.getContext('2d');
  const M = 64;
  const W = IMAGE_W - M * 2;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, IMAGE_W, IMAGE_H);

  // 見出し
  text(ctx, 'Pourfolio', M, 96, { px: 34, weight: 700, color: C.accent });
  text(ctx, c.when, IMAGE_W - M, 96, { px: 30, color: C.muted, align: 'right' });
  text(ctx, c.beanName, M, 186, { px: 64, weight: 700, maxW: W });
  text(ctx, [c.beanSub, c.days].filter(Boolean).join('　'), M, 240, { px: 32, color: C.muted, maxW: W });

  // 評価
  let y = 300;
  if (c.stars != null) {
    const s = '★'.repeat(c.stars) + '☆'.repeat(Math.max(0, c.starMax - c.stars));
    text(ctx, s, M, y + 56, { px: 64, color: C.star });
    y += 84;
  }
  if (c.flavors) {
    text(ctx, c.flavors, M, y + 40, { px: 36, weight: 700, maxW: W });
    y += 56;
  }
  if (c.notes) {
    text(ctx, c.notes, M, y + 36, { px: 30, color: C.muted, maxW: W });
    y += 50;
  }

  // 条件（3列のマス）
  y += 20;
  const cols = 3;
  const gap = 16;
  const cellW = (W - gap * (cols - 1)) / cols;
  const cellH = 110;
  c.stats.forEach((s, i) => {
    const x = M + (i % cols) * (cellW + gap);
    const yy = y + Math.floor(i / cols) * (cellH + gap);
    ctx.fillStyle = C.card;
    roundRect(ctx, x, yy, cellW, cellH, 18);
    ctx.fill();
    text(ctx, s.label, x + 22, yy + 40, { px: 26, color: C.muted });
    text(ctx, s.value, x + 22, yy + 88, { px: 40, weight: 700, maxW: cellW - 44 });
  });
  y += Math.ceil(c.stats.length / cols) * (cellH + gap) + 12;

  // 注湯の流れ
  const chartH = Math.max(220, IMAGE_H - y - (c.memo ? 230 : 150));
  ctx.fillStyle = C.card;
  roundRect(ctx, M, y, W, chartH, 18);
  ctx.fill();
  text(ctx, `注湯の流れ${c.recipe ? `　${c.recipe}` : ''}`, M + 24, y + 46, { px: 28, color: C.muted, maxW: W - 48 });
  const ch = pourChart(c.pours, c.totalSec);
  if (ch.steps.length) {
    const px0 = M + 70;
    const py0 = y + chartH - 50;
    const pw = W - 110;
    const ph = chartH - 120;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px0, py0 - ph);
    ctx.lineTo(px0, py0);
    ctx.lineTo(px0 + pw, py0);
    ctx.stroke();
    text(ctx, `${ch.maxG}g`, px0 - 10, py0 - ph + 10, { px: 22, color: C.muted, align: 'right' });
    text(ctx, '0', px0 - 10, py0, { px: 22, color: C.muted, align: 'right' });
    text(ctx, formatSec(ch.maxSec), px0 + pw, py0 + 34, { px: 22, color: C.muted, align: 'right' });
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ch.steps.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, px0 + p.x * pw, py0 - p.y * ph));
    ctx.stroke();
    ctx.fillStyle = C.fg;
    for (const d of ch.dots) {
      ctx.beginPath();
      ctx.arc(px0 + d.x * pw, py0 - d.y * ph, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    if (c.totalSec != null) {
      const x = px0 + (c.totalSec / ch.maxSec) * pw;
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(x, py0);
      ctx.lineTo(x, py0 - ph);
      ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, `落ち切り ${formatSec(c.totalSec)}`, Math.min(x, px0 + pw - 4), py0 - ph - 10, { px: 22, color: C.muted, align: x > px0 + pw / 2 ? 'right' : 'left' });
    }
  } else {
    text(ctx, '注湯の記録がありません', M + 24, y + 110, { px: 28, color: C.muted });
  }
  y += chartH + 24;

  if (c.memo) {
    // メモは2行まで
    ctx.font = font(30);
    const chars = [...c.memo];
    const lines = [];
    let cur = '';
    for (const ch2 of chars) {
      if (ch2 === '\n' || ctx.measureText(cur + ch2).width > W) {
        lines.push(cur);
        cur = ch2 === '\n' ? '' : ch2;
      } else cur += ch2;
    }
    lines.push(cur);
    lines.slice(0, 2).forEach((l, i) => text(ctx, l, M, y + 36 + i * 44, { px: 30, color: C.fg }));
  }
  return cv;
}

/** canvas を PNG のファイルにする */
export function canvasToFile(cv, name) {
  return new Promise((resolve, reject) => {
    cv.toBlob((blob) => (blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(new Error('画像にできませんでした'))), 'image/png');
  });
}
