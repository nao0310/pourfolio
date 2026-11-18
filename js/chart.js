// グラフをSVGで描く小さな部品（D-116：グラフの部品は入れない）。計算は js/core/chart-scale.js。
// 色はCSSの変数（css/base.css の .chart）で付け、ダーク／ライトに合わせる。色だけに頼らず、点には title（長押し・ホバーで出る）を付ける。

import { niceTicks, linearScale } from './core/chart-scale.js';
import { el } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

/** SVGの要素を作る */
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) node.setAttribute(k, String(v));
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const fmt = (n) => String(Number(n.toFixed(4)));

/**
 * 座標軸のあるグラフ。
 * @param {object} o
 * @param {{min?:number, max?:number, label?:string, ticks?:number, format?:(n:number)=>string, labels?:Record<number,string>}} o.x
 * @param {{min?:number, max?:number, label?:string, ticks?:number, format?:(n:number)=>string}} o.y
 * @param {{x:number, y:number, level?:number, title?:string, hollow?:boolean}[]} [o.points] 点（level は★の色 1〜5、0は色なし）
 * @param {{x0:number, x1:number, y0:number, y1:number, cls:string, label?:string}[]} [o.rects] 範囲の四角
 * @param {{points:[number, number][], cls:string, label?:string}[]} [o.lines] 折れ線・直線
 * @param {{x:number, y:number, title?:string}[]} [o.bars] 棒（x を中心に幅 barWidth）
 * @param {number} [o.barWidth] 棒の幅（x の単位）
 * @param {string} o.ariaLabel 読み上げ用の説明
 * @param {number} [o.width] @param {number} [o.height]
 */
export function plot(o) {
  const W = o.width ?? 340;
  const H = o.height ?? 240;
  const m = { l: 44, r: 12, t: o.y.label ? 24 : 12, b: o.x.label ? 40 : 26 };
  const all = (k) => [
    ...(o.points ?? []).map((p) => p[k]),
    ...(o.bars ?? []).map((b) => b[k]),
    ...(o.rects ?? []).flatMap((r) => [r[`${k}0`], r[`${k}1`]]),
    ...(o.lines ?? []).filter((l) => !l.free).flatMap((l) => l.points.map((p) => p[k === 'x' ? 0 : 1])),
  ].filter(Number.isFinite);
  const xs = all('x');
  const ys = all('y');
  const xt = niceTicks(o.x.min ?? Math.min(...xs), o.x.max ?? Math.max(...xs), o.x.ticks ?? 5);
  const yt = niceTicks(o.y.min ?? Math.min(...ys), o.y.max ?? Math.max(...ys), o.y.ticks ?? 4);
  const xmin = o.x.min ?? xt.min;
  const xmax = o.x.max ?? xt.max;
  const ymin = o.y.min ?? yt.min;
  const ymax = o.y.max ?? yt.max;
  const sx = linearScale([xmin, xmax], [m.l, W - m.r]);
  const sy = linearScale([ymin, ymax], [H - m.b, m.t]);
  const fx = o.x.format ?? fmt;
  const fy = o.y.format ?? fmt;
  const clipId = `clip${Math.random().toString(36).slice(2, 8)}`;

  const grid = [
    ...yt.ticks.filter((t) => t >= ymin && t <= ymax).map((t) =>
      svg('g', {}, svg('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }), svg('text', { class: 'tick', x: m.l - 6, y: sy(t) + 4, 'text-anchor': 'end' }, fy(t))),
    ),
    ...xt.ticks.filter((t) => t >= xmin && t <= xmax).map((t) =>
      svg('g', {}, svg('line', { class: 'grid', y1: m.t, y2: H - m.b, x1: sx(t), x2: sx(t) }), svg('text', { class: 'tick', x: sx(t), y: H - m.b + 16, 'text-anchor': 'middle' }, o.x.labels?.[t] ?? fx(t))),
    ),
  ];
  const rects = (o.rects ?? []).map((r) =>
    svg(
      'g',
      {},
      svg('rect', { class: r.cls, x: sx(Math.min(r.x0, r.x1)), y: sy(Math.max(r.y0, r.y1)), width: Math.abs(sx(r.x1) - sx(r.x0)), height: Math.abs(sy(r.y0) - sy(r.y1)) }),
      r.label ? svg('text', { class: `rect-label ${r.cls}-label`, x: sx(Math.min(r.x0, r.x1)) + 4, y: sy(Math.max(r.y0, r.y1)) + 13 }, r.label) : null,
    ),
  );
  const lines = (o.lines ?? []).map((l) =>
    svg(
      'g',
      {},
      svg('polyline', { class: l.cls, points: l.points.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ') }),
      l.label && l.points.length
        ? svg('text', { class: `line-label ${l.cls}-label`, x: sx(l.points[l.points.length - 1][0]) - 2, y: sy(l.points[l.points.length - 1][1]) - 4, 'text-anchor': 'end' }, l.label)
        : null,
    ),
  );
  const bw = o.barWidth ?? 1;
  const bars = (o.bars ?? []).map((b) => {
    const x0 = sx(b.x - bw / 2) + 1;
    const x1 = sx(b.x + bw / 2) - 1;
    const y0 = sy(Math.max(ymin, 0));
    const y1 = sy(b.y);
    return svg('rect', { class: 'bar', x: x0, y: Math.min(y0, y1), width: Math.max(1, x1 - x0), height: Math.abs(y0 - y1) }, b.title ? svg('title', {}, b.title) : null);
  });
  const points = (o.points ?? []).map((p) =>
    svg('circle', { class: `pt lv-${p.level ?? 0}${p.hollow ? ' hollow' : ''}`, cx: sx(p.x), cy: sy(p.y), r: o.pointR ?? 5.5 }, p.title ? svg('title', {}, p.title) : null),
  );

  return svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': o.ariaLabel },
    svg('defs', {}, svg('clipPath', { id: clipId }, svg('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }))),
    ...grid,
    svg('line', { class: 'axis', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }),
    svg('line', { class: 'axis', x1: m.l, x2: m.l, y1: m.t, y2: H - m.b }),
    svg('g', { 'clip-path': `url(#${clipId})` }, ...rects, ...lines, ...bars, ...points),
    o.x.label ? svg('text', { class: 'axis-label', x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }, o.x.label) : null,
    o.y.label ? svg('text', { class: 'axis-label', x: 4, y: 14 }, o.y.label) : null,
  );
}

/** ★の色の凡例（★1〜★5） */
export function starLegend() {
  return el(
    'p',
    { class: 'legend' },
    ...[1, 2, 3, 4, 5].map((n) => el('span', { class: 'legend-item' }, el('span', { class: `swatch lv-${n}` }), `★${n}`)),
  );
}

/** 図の枠（見出しなし。説明の文を下に添える） */
export function chartBox(node, ...notes) {
  return el('figure', { class: 'chart' }, node, ...notes.filter(Boolean).map((t) => (typeof t === 'string' ? el('figcaption', { class: 'muted small' }, t) : t)));
}
