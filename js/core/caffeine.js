// カフェイン・タイムキーパー（X17）：今日の推定摂取量と、控える時刻までの残り時間（純粋関数）
// 「今日」は朝5時から次の朝5時まで（夜中の杯は前の日に数える。today.js の caffeineState と同じ区切り）。
// 1杯の量は extraction.js の目安（analysisRows の metrics.caffeineMg）。カフェインレスの豆の杯は数えない（D-142）。

import { cutoffStatus, DAILY_CAFFEINE_MG } from './today.js';
import { cupsOf } from './plan-adjust.js';

/** 1日の区切り（時） */
export const DAY_START_HOUR = 5;

/** その時刻を含む「1日」の始まり（朝5時） */
export function coffeeDayStart(now) {
  const d = new Date(now);
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  return d;
}

/**
 * 1杯のうち自分が飲んだカフェイン（mg）。カフェインレスの豆は0、量を出せなければ null。
 * 来客などで2〜4杯まとめて淹れた杯は杯数で割る（2-8の40番。「少なめ」は1人分なので割らない）
 * @param {object} r analysisRows の行
 */
export function myCaffeineMg(r) {
  if (r?.bean?.decaf) return 0;
  const mg = r?.metrics?.caffeineMg;
  if (mg == null) return null;
  const cups = cupsOf(r.brew);
  return cups > 1 ? Math.round(mg / cups) : mg;
}

/**
 * 今日（朝5時から今まで）のカフェインの合計
 * @param {object[]} rows analysisRows の結果
 * @returns {{mg:number, cups:number, unknown:number}} unknown は量を出せなかった杯
 */
export function todayCaffeine(rows, now) {
  const from = coffeeDayStart(now).getTime();
  const to = new Date(now).getTime();
  let mg = 0;
  let cups = 0;
  let unknown = 0;
  for (const r of rows ?? []) {
    const t = new Date(r.brew?.at ?? r.at).getTime();
    if (!(t >= from && t <= to)) continue;
    cups += 1;
    const my = myCaffeineMg(r);
    if (my != null) mg += my;
    else unknown += 1;
  }
  return { mg, cups, unknown };
}

/** 分を「2時間10分」「45分」にする */
export function durationText(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}

/**
 * タイムキーパーの表示
 * @param {{now:Date, cutoff?:string|null, mg?:number, limitMg?:number}} p
 * @returns {{mg:number, limitMg:number, pct:number, minutesLeft:number|null, late:boolean, over:boolean, main:string, sub:string}}
 */
export function caffeineKeeper({ now, cutoff = null, mg = 0, limitMg = DAILY_CAFFEINE_MG }) {
  const { past: pastCutoff, minutesLeft } = cutoffStatus(now, cutoff);
  const over = mg >= limitMg;
  const main = `今日のカフェイン 約${mg}mg／目安${limitMg}mg`;
  let sub;
  if (pastCutoff) sub = `${cutoff}を過ぎました。今日はカフェインレスか少なめにしましょう`;
  else if (over) sub = '目安に届きました。今日はカフェインレスか少なめにしましょう';
  else if (minutesLeft != null) sub = `控える時刻 ${cutoff} まで、あと${durationText(minutesLeft)}`;
  else sub = '控える時刻は「今日の1杯」の画面で決められます';
  return { mg, limitMg, pct: Math.min(100, Math.round((mg / limitMg) * 100)), minutesLeft, late: pastCutoff || over, over, main, sub };
}
