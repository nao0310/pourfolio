// ガイド付きタイマー（A2）の計算（純粋関数）
// - 時間はスタートした時刻との差（経過秒）で計算する。画面の更新が止まってもずれない（spec 8.1）
// - laps は「何投目まで注ぎ終えたか」の記録。laps[i] は i投目（0＝蒸らし）の注湯完了を押した経過秒。
//   押さずに次の投の時刻が来たら null で埋めて先へ進む（押し忘れても止まらない）

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
 * 注湯完了を押したときの laps。直前に押してから LAP_GUARD_SEC 以内なら押し間違いとして無視する。
 * 全部の投が終わっていたら変えない。
 */
export function addLap(pours, laps, elapsedSec) {
  const cur = autoAdvance(pours, laps, elapsedSec);
  if (cur.length >= pours.length) return cur;
  const lastTap = [...cur].reverse().find((x) => x != null);
  if (lastTap != null && elapsedSec - lastTap < LAP_GUARD_SEC) return cur;
  return [...cur, round1(elapsedSec)];
}

/**
 * 今の画面に出す内容。
 * - phase 'wait'：次の投の時刻待ち（あと何秒）
 * - phase 'pour'：注ぐ時間（累計何gまで）。次の投があれば、それまであと何秒
 * - phase 'drawdown'：全部注ぎ終えて落ち切り待ち（目標時間まであと何秒、マイナスは超過）
 * @param {{pours:{atSec:number,toG:number}[], targetTotalSec?:number|null}} plan
 * @param {(number|null)[]} laps
 * @param {number} elapsedSec
 */
export function timerView(plan, laps, elapsedSec) {
  const pours = plan.pours ?? [];
  const done = autoAdvance(pours, laps, elapsedSec);
  const index = done.length;
  const target = plan.targetTotalSec ?? null;
  if (index >= pours.length) {
    return {
      phase: 'drawdown',
      index,
      laps: done,
      secsToTarget: target != null ? Math.ceil(target - elapsedSec) : null,
    };
  }
  const p = pours[index];
  const prevG = index > 0 ? pours[index - 1].toG : 0;
  const next = pours[index + 1] ?? null;
  const base = {
    index,
    laps: done,
    name: pourName(index),
    toG: p.toG,
    addG: round1(p.toG - prevG),
    style: p.style ?? '',
    isLast: index === pours.length - 1,
  };
  if (elapsedSec < p.atSec) return { ...base, phase: 'wait', secsLeft: Math.ceil(p.atSec - elapsedSec) };
  return {
    ...base,
    phase: 'pour',
    secsToNext: next ? Math.ceil(next.atSec - elapsedSec) : null,
    secsToTarget: target != null ? Math.ceil(target - elapsedSec) : null,
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
 */
export function cuesBetween(plan, fromSec, toSec) {
  const hits = cueSchedule(plan).filter((c) => c.sec > fromSec && c.sec <= toSec);
  if (toSec - fromSec <= MAX_CUE_GAP_SEC) return hits;
  const recent = hits.filter((c) => c.sec >= toSec - 1);
  return recent.length ? [recent[recent.length - 1]] : [];
}
