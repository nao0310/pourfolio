// ガイド付きタイマー（A2）の計算（純粋関数）
// - 時間はスタートした時刻との差（経過秒）で計算する。画面の更新が止まってもずれない（spec 8.1）
// - laps は「何投目まで注ぎ終えたか」の記録。laps[i] は i投目（0＝蒸らし）の注湯完了を押した経過秒。
//   押さずに次の投の時刻が来たら null で埋めて先へ進む（押し忘れても止まらない）
// - 1投は「注ぐ」（注湯の時刻から注ぐ秒数のあいだ）と「待つ」（次の注湯の時刻まで）に分けて表示する

import { pourSecOf, flowOf } from './recipes.js';

/** 注湯の何秒前からカウント音を鳴らすか */
export const COUNTDOWN_SEC = 3;
/** これより長く画面の更新が止まっていたら、たまった合図は最新の1つだけ鳴らす */
export const MAX_CUE_GAP_SEC = 2;
/** 注湯完了の押し間違い（2度押し）を防ぐ間隔 */
export const LAP_GUARD_SEC = 1.5;

const round1 = (n) => Math.round(n * 10) / 10;

/** 何投目かの呼び名（0＝蒸らし） */
export function pourName(index) {
  return index === 0 ? '蒸らし' : `${index + 1}投目`;
}

/** 注湯の合図で読み上げる文「2投目、150グラムまで」 */
export function speechFor(pours, index) {
  const p = pours[index];
  if (!p) return '';
  return `${pourName(index)}、${round1(p.toG)}グラムまで`;
}

/**
 * 時刻が来たのに押されていない投を null で埋める（次の投の時刻を過ぎたら、前の投は終わったとみなす）
 * @param {{atSec:number}[]} pours
 * @param {(number|null)[]} laps
 * @param {number} elapsedSec
 * @returns {(number|null)[]} 新しい laps（変わらなければ同じ中身の写し）
 */
export function autoAdvance(pours, laps, elapsedSec) {
  const out = [...laps];
  while (out.length < pours.length - 1 && elapsedSec >= pours[out.length + 1].atSec) out.push(null);
  return out;
}

/**
 * i投目の注ぎ終わりの目安（経過秒）。注ぐ秒数のない古い計画は注ぐ量÷流速で計算する。
 * 次の注湯の時刻は越えない
 * @param {{pours:object[], flowGps?:number}} plan
 * @param {number} i
 */
export function pourEndSec(plan, i) {
  const pours = plan.pours ?? [];
  const p = pours[i];
  if (!p) return null;
  const end = p.atSec + (pourSecOf(pours, i, plan.flowGps) ?? 0);
  const next = pours[i + 1];
  return next ? Math.min(end, next.atSec) : end;
}

/**
 * 注湯完了を押したときの laps。直前に押してから LAP_GUARD_SEC 以内なら押し間違いとして無視する。
 * 全部の投が終わっていたら変えない。次の投の時刻より前（待っているあいだ）に押しても変えない。
 */
export function addLap(pours, laps, elapsedSec) {
  const cur = autoAdvance(pours, laps, elapsedSec);
  if (cur.length >= pours.length) return cur;
  if (elapsedSec < pours[cur.length].atSec) return cur;
  const lastTap = [...cur].reverse().find((x) => x != null);
  if (lastTap != null && elapsedSec - lastTap < LAP_GUARD_SEC) return cur;
  // スタートの2度押し：スタートから LAP_GUARD_SEC 以内の最初のタップは押し間違いとして無視する（2-8 の17番）
  if (lastTap == null && elapsedSec < LAP_GUARD_SEC) return cur;
  return [...cur, round1(elapsedSec)];
}

/**
 * 落ち切り待ちで「落ち切った」を押したとき、終わりにしてよいか（2-8 の5番）。
 * 最後の投の「注ぎ終えた」を押してから LAP_GUARD_SEC 以内は、2度押しとして無視する（D-036 を終わりにも当てる）
 * @param {(number|null)[]} laps
 * @param {number} elapsedSec
 */
export function canFinish(laps, elapsedSec) {
  const lastTap = [...(laps ?? [])].reverse().find((x) => x != null);
  return lastTap == null || elapsedSec - lastTap >= LAP_GUARD_SEC;
}

/**
 * 今の画面に出す内容。
 * - phase 'pour'：注ぐ（累計何gまで、注ぎ終わりまであと何秒、流速）
 * - phase 'wait'：待つ（次の注湯まであと何秒）。次の投は next に入る
 *     - 注湯完了を押したあと、または最初の投の前：index は次の投、canTap=false（押しても何も起きない）
 *     - 注ぐ秒数が過ぎたが注湯完了を押していない：index は今の投のまま、canTap=true（押すとこの投の完了を記録）
 *       最後の投なら next は null
 * - phase 'drawdown'：全部注ぎ終えて落ち切り待ち（目標時間まであと何秒、マイナスは超過）
 * @param {{pours:{atSec:number,toG:number,pourSec?:number}[], targetTotalSec?:number|null, flowGps?:number}} plan
 * @param {(number|null)[]} laps
 * @param {number} elapsedSec
 */
export function timerView(plan, laps, elapsedSec) {
  const pours = plan.pours ?? [];
  const done = autoAdvance(pours, laps, elapsedSec);
  const index = done.length;
  const target = plan.targetTotalSec ?? null;
  const secsToTarget = target != null ? Math.ceil(target - elapsedSec) : null;
  if (index >= pours.length) {
    return { phase: 'drawdown', index, laps: done, secsToTarget };
  }
  const info = (i) => {
    const p = pours[i];
    const prevG = i > 0 ? pours[i - 1].toG : 0;
    const addG = round1(p.toG - prevG);
    const pourSec = pourEndSec(plan, i) - p.atSec;
    return {
      index: i,
      name: pourName(i),
      toG: p.toG,
      addG,
      style: p.style ?? '',
      atSec: p.atSec,
      pourSec,
      flowGps: flowOf(addG, pourSec),
      isLast: i === pours.length - 1,
    };
  };
  const cur = info(index);
  if (elapsedSec < cur.atSec) {
    return { phase: 'wait', index, laps: done, canTap: false, next: cur, secsLeft: Math.ceil(cur.atSec - elapsedSec), secsToTarget };
  }
  const endSec = cur.atSec + cur.pourSec;
  if (elapsedSec < endSec) {
    return { ...cur, phase: 'pour', laps: done, secsLeft: Math.ceil(endSec - elapsedSec), secsToTarget };
  }
  const next = cur.isLast ? null : info(index + 1);
  return {
    ...cur,
    phase: 'wait',
    laps: done,
    canTap: true,
    next,
    secsLeft: next ? Math.ceil(next.atSec - elapsedSec) : null,
    secsToTarget,
  };
}

/** 計画から合図の一覧を作る（経過秒の順） */
export function cueSchedule(plan) {
  const pours = plan.pours ?? [];
  const cues = [];
  pours.forEach((p, i) => {
    for (let k = COUNTDOWN_SEC; k >= 1; k--) {
      const sec = p.atSec - k;
      if (sec > 0) cues.push({ sec, kind: 'count', index: i, n: k });
    }
    cues.push({ sec: p.atSec, kind: 'go', index: i, speech: speechFor(pours, i) });
    const end = pourEndSec(plan, i);
    const next = pours[i + 1];
    // 注ぎ終わりの目安。次の注湯のカウントと重なる（3秒前より後）ときは鳴らさない
    if (end > p.atSec && (!next || end <= next.atSec - COUNTDOWN_SEC - 1)) cues.push({ sec: end, kind: 'pourEnd', index: i });
  });
  const target = plan.targetTotalSec;
  if (target != null && pours.length && target > pours[pours.length - 1].atSec) {
    cues.push({ sec: target, kind: 'target', speech: '目標時間です' });
  }
  return cues.sort((a, b) => a.sec - b.sec);
}

/**
 * fromSec より後で toSec まで（fromSec < sec ≦ toSec）に来た合図。
 * 画面の更新が MAX_CUE_GAP_SEC より長く止まっていたら（別のアプリから戻ったときなど）、
 * まとめて鳴らさず、1秒以内に来た最新の1つだけ返す。
 * 注湯完了を押した投（laps に秒がある投）の注ぎ終わりの合図は鳴らさない。
 * @param {(number|null)[]} [laps]
 */
export function cuesBetween(plan, fromSec, toSec, laps = []) {
  const hits = cueSchedule(plan).filter(
    (c) => c.sec > fromSec && c.sec <= toSec && !(c.kind === 'pourEnd' && laps[c.index] != null),
  );
  if (toSec - fromSec <= MAX_CUE_GAP_SEC) return hits;
  const recent = hits.filter((c) => c.sec >= toSec - 1);
  return recent.length ? [recent[recent.length - 1]] : [];
}
