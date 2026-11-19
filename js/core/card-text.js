// レシピカード（X2）とキャニスターのラベル（X14）に載せる文字（純粋関数）
// 名刺（91×55mm）は要点だけ、A6（105×148mm）は注湯の流れとメモまで。

import { recipeSummary, formatSec, templateLabel, POUR_STYLES } from './recipes.js';
import { formatYmdJa } from './format.js';

export const CARD_SIZES = Object.freeze({
  card: { label: '名刺', w: 91, h: 55 },
  a6: { label: 'A6', w: 105, h: 148 },
});

/** 長い文字を切り詰める（…を付ける） */
export function clip(text, max) {
  const s = String(text ?? '');
  return [...s].length > max ? `${[...s].slice(0, max - 1).join('')}…` : s;
}

/** 注湯の1行「0:45　2投目　120gまで（の字）」 */
export function pourLine(p, i) {
  return `${formatSec(p.atSec)}　${i === 0 ? '蒸らし' : `${i + 1}投目`}　${p.toG}gまで${POUR_STYLES[p.style] ? `（${POUR_STYLES[p.style]}）` : ''}`;
}

/**
 * レシピカードの中身
 * @param {{recipe:object, bean?:object|null, grinderName?:string, dripperName?:string, size?:'card'|'a6'}} p
 */
export function recipeCardText({ recipe, bean = null, grinderName = '', dripperName = '', size = 'card' }) {
  const small = size === 'card';
  const grind = [grinderName, recipe.grind?.setting].filter(Boolean).join(' ');
  return {
    title: clip(recipe.name, small ? 18 : 24),
    bean: bean ? clip([bean.name, bean.roastLevel].filter(Boolean).join('・'), small ? 24 : 34) : '',
    summary: recipeSummary({ ...recipe, grind: null }),
    gear: [grind ? `挽き目 ${grind}` : '', dripperName].filter(Boolean).join('　'),
    pours: (recipe.pours ?? []).map(pourLine),
    target: recipe.targetTotalSec ? `落ち切り ${formatSec(recipe.targetTotalSec)}` : '',
    template: templateLabel(recipe.template),
    // メモは A6 だけ（名刺には入らない）。共有リンクから取り込んだ説明も載る
    memo: small ? '' : clip(recipe.memo ?? '', 120),
  };
}

/** キャニスターのラベルの中身 */
export function canisterLabelText(bean) {
  return {
    title: clip(bean.name, 18),
    sub: [bean.roastLevel, bean.origin?.country].filter(Boolean).join('・'),
    roast: bean.roastDate ? `焙煎 ${formatYmdJa(bean.roastDate)}` : '',
    howTo: 'アプリの「QRを読む」で淹れる',
  };
}
