// 抽出レポートの1枚画像（X3）に載せる中身（純粋関数）。描くのは js/brew-image.js（canvas）。
// 豆・条件・注湯の流れ・評価・テイスティングノート。メモは自分用の文なので、入れるかを選べる（初めは入れない）。

import { formatSec } from './recipes.js';
import { formatDateTimeJa } from './format.js';
import { flavorsText } from './flavors.js';
import { STAR_MAX, JAR_ATTRS, jarWord } from './tastings.js';
import { clip } from './card-text.js';

/** 画像の大きさ（SNS の縦長 4:5） */
export const IMAGE_W = 1080;
export const IMAGE_H = 1350;

/**
 * @param {{brew:object, bean?:object|null, tasting?:object|null, recipeName?:string, grinderName?:string, metrics?:object, withMemo?:boolean}} p
 *   metrics は extraction.js の brewMetrics の結果（TDS・収率があれば載せる）
 */
export function brewImageContent({ brew, bean = null, tasting = null, recipeName = '', grinderName = '', metrics = {}, withMemo = false }) {
  const a = brew.actual ?? {};
  const ratio = metrics.ratio ?? brew.derived?.ratio ?? null;
  const grind = [grinderName, a.grind?.setting].filter(Boolean).join(' ');
  const stats = [
    { label: '粉', value: a.doseG != null ? `${a.doseG}g` : '—' },
    { label: '湯', value: a.waterG != null ? `${a.waterG}g` : '—' },
    { label: '比率', value: ratio ? `1:${ratio}` : '—' },
    { label: '湯温', value: a.tempC != null ? `${a.tempC}℃` : '—' },
    { label: '挽き目', value: grind || '—' },
    { label: '時間', value: a.totalSec != null ? formatSec(a.totalSec) : '—' },
  ];
  if (metrics.tdsPct != null) stats.push({ label: 'TDS', value: `${metrics.tdsPct}%` });
  if (metrics.eyPct != null) stats.push({ label: '収率', value: `${metrics.eyPct}%` });
  if (brew.context?.iceG > 0) stats.push({ label: '氷', value: `${brew.context.iceG}g` });

  const pours = (a.pours?.length ? a.pours : brew.planned?.pours ?? []).filter((p) => Number.isFinite(p.atSec) && Number.isFinite(p.toG));
  const offJar = JAR_ATTRS.filter((x) => tasting?.jar?.[x.key] != null && tasting.jar[x.key] !== 0).map((x) => `${x.label} ${jarWord(x.key, tasting.jar[x.key])}`);
  const notes = [tasting?.tags?.length ? tasting.tags.join('・') : '', offJar.join('・')].filter(Boolean).join('　');
  return {
    when: formatDateTimeJa(brew.at),
    beanName: clip(bean?.name ?? '豆なし', 22),
    beanSub: clip([bean?.roastLevel, bean?.origin?.country, bean?.process].filter(Boolean).join('・'), 30),
    days: brew.derived?.daysOffRoast != null ? `焙煎から${brew.derived.daysOffRoast}日` : '',
    recipe: clip(recipeName, 24),
    stats,
    pours: pours.map((p) => ({ atSec: p.atSec, toG: p.toG, doneSec: Number.isFinite(p.doneSec) ? p.doneSec : null })),
    totalSec: Number.isFinite(a.totalSec) ? a.totalSec : null,
    stars: Number.isFinite(tasting?.stars) ? tasting.stars : null,
    starMax: STAR_MAX,
    flavors: clip(flavorsText(tasting?.flavors ?? [], 6), 40),
    notes: clip(notes, 44),
    memo: withMemo ? clip(tasting?.memo || brew.memo || '', 90) : '',
  };
}

/**
 * 注湯の流れのグラフの点（時間→累計湯量の階段）。x・y は 0〜1
 * @returns {{maxSec:number, maxG:number, steps:{x:number,y:number}[], dots:{x:number,y:number}[]}}
 */
export function pourChart(pours = [], totalSec = null) {
  if (!pours.length) return { maxSec: 0, maxG: 0, steps: [], dots: [] };
  const lastAt = Math.max(...pours.map((p) => p.atSec), ...pours.map((p) => p.doneSec ?? 0));
  const maxSec = Math.max(totalSec ?? 0, lastAt + 30, 60);
  const maxG = Math.max(...pours.map((p) => p.toG));
  const steps = [{ x: 0, y: 0 }];
  let prev = 0;
  for (const p of pours) {
    steps.push({ x: p.atSec / maxSec, y: prev / maxG });
    steps.push({ x: p.atSec / maxSec, y: p.toG / maxG });
    prev = p.toG;
  }
  steps.push({ x: 1, y: prev / maxG });
  const dots = pours.filter((p) => p.doneSec != null).map((p) => ({ x: p.doneSec / maxSec, y: p.toG / maxG }));
  return { maxSec, maxG, steps, dots };
}

/** 画像のファイル名「pourfolio-2026-11-18-0742.png」 */
export function imageFileName(at) {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return `pourfolio-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
}
