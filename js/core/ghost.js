// 前回のベストのペース（ゴースト、spec 8.1・D-041）：同じレシピで★がいちばん高かった杯の注湯の時刻と比べ、
// 今回のズレを秒で出す（純粋関数）。比べられる杯がなければ出さない。

import { pickTasting } from './tastings.js';
import { formatSec } from './recipes.js';
import { localYmd, formatYmdJa } from './format.js';

/**
 * 比べる杯を選ぶ：同じレシピ・タイマーで淹れた・注湯完了の時刻がある・★がある杯のうち、★が高い→同じ豆→新しい順。
 * アイスや杯数を変えた杯（量が違うのでペースも違う）は比べない。
 * @returns {{brewId:string, stars:number, ymd:string, laps:(number|null)[], totalSec:number|null, sameBean:boolean}|null}
 */
export function pickGhost({ brews = [], tastings = [], recipeId = null, beanId = null } = {}) {
  if (!recipeId) return null;
  const cands = [];
  for (const b of brews ?? []) {
    if (b.deletedAt != null || b.recipeId !== recipeId || !b.timerUsed) continue;
    if (b.context?.iceG > 0 || (b.context?.cups ?? 1) !== 1) continue;
    const laps = (b.actual?.pours ?? []).map((p) => (Number.isFinite(p?.doneSec) ? p.doneSec : null));
    if (!laps.some((x) => x != null)) continue;
    const t = pickTasting(tastings, b.id);
    if (!Number.isFinite(t?.stars)) continue;
    cands.push({ b, t, laps });
  }
  if (!cands.length) return null;
  cands.sort(
    (x, y) =>
      y.t.stars - x.t.stars ||
      Number(y.b.beanId === beanId && beanId != null) - Number(x.b.beanId === beanId && beanId != null) ||
      String(y.b.at).localeCompare(String(x.b.at)),
  );
  const { b, t, laps } = cands[0];
  return {
    brewId: b.id,
    stars: t.stars,
    ymd: localYmd(b.at),
    laps,
    totalSec: Number.isFinite(b.actual?.totalSec) ? b.actual.totalSec : null,
    sameBean: beanId != null && b.beanId === beanId,
  };
}

const signedSec = (n) => (n === 0 ? '±0秒' : `${n > 0 ? '+' : '−'}${Math.abs(n)}秒`);

/**
 * タイマーに出すゴーストの1行。
 * - 注湯完了を押した直後：その投のベストとの差「ベスト比 +5秒（2投目）」（+ は今回のほうが遅い）
 * - それ以外：今の投のベストの時刻「ベスト（★5・11/12）は 2投目を 1:05 に注ぎ終え」
 * - 落ち切り待ち：ベストの総時間
 * @param {object|null} ghost pickGhost の結果
 * @param {(number|null)[]} laps 今回押した時刻
 * @param {{phase:string, index:number}} view timerView の結果
 * @param {(i:number)=>string} pourName 「2投目」
 */
export function ghostLine(ghost, laps, view, pourName) {
  if (!ghost) return '';
  const who = `ベスト（★${ghost.stars}・${formatYmdJa(ghost.ymd)}）`;
  if (view.phase === 'drawdown') {
    return ghost.totalSec != null ? `${who}の総時間は ${formatSec(ghost.totalSec)}` : '';
  }
  // 注湯完了を押したあとの待ち時間：押した投のベストとの差
  const last = (laps?.length ?? 0) - 1;
  if (view.phase === 'wait' && last >= 0 && laps[last] != null && ghost.laps[last] != null) {
    return `ベスト比 ${signedSec(Math.round(laps[last] - ghost.laps[last]))}（${pourName(last)}）`;
  }
  const i = view.index;
  const g = ghost.laps[i];
  return g != null ? `${who}は ${pourName(i)}を ${formatSec(Math.round(g))} に注ぎ終え` : '';
}
