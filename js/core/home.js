// ホーム（E1）と保存の促し（G2）の計算（純粋関数）
// ホームには「今日の1杯」「在庫アラート」「豆ごとの飲み頃の帯」「直近の抽出」と最後の書き出しを出す。

import { freshness, daysBetween } from './freshness.js';
import { remainingG, cupsLeft, groupTxByBean } from './inventory.js';
import { sortBeansForList } from './beans.js';
import { pickTasting } from './tastings.js';
import { localYmd } from './format.js';
import { groupPortionsByBean, stockParts } from './frozen.js';

/** 前回の書き出しからこの日数が過ぎたら書き出しを促す */
export const BACKUP_REMIND_DAYS = 7;
/** 前回の書き出しからこの杯数を記録したら書き出しを促す */
export const BACKUP_REMIND_BREWS = 10;
/** 残りがこの杯数以下なら在庫アラート */
export const LOW_STOCK_CUPS = 3;
/** 直近の抽出に出す数 */
export const RECENT_BREWS = 3;
/** 記録にかかった時間として扱う上限（これより長いのは、あとで評価したもの） */
export const RECORD_SEC_MAX = 30 * 60;

const alive = (r) => r && r.deletedAt == null;
const ms = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? null : t;
};

/**
 * 保存の促し（G2）。前回の書き出しから7日、または10杯の早いほうで促す。
 * 一度も書き出していなければ、抽出か豆が1件でもあれば促す。
 * @param {{lastBackupAt?:string|null, brews?:object[], hasRecords?:boolean, now?:Date|number|string}} p
 * @returns {{due:boolean, never:boolean, daysSince:number|null, brewsSince:number, reason:string}}
 */
export function backupReminder({ lastBackupAt = null, brews = [], hasRecords = false, now = new Date() }) {
  const last = ms(lastBackupAt);
  const list = (brews ?? []).filter(alive);
  if (last == null) {
    const due = hasRecords || list.length > 0;
    return { due, never: true, daysSince: null, brewsSince: list.length, reason: due ? 'まだ一度も書き出していません' : '' };
  }
  const daysSince = daysBetween(localYmd(last), localYmd(now)) ?? 0;
  const brewsSince = list.filter((b) => (ms(b.createdAt) ?? 0) > last).length;
  const byDays = daysSince >= BACKUP_REMIND_DAYS;
  const byBrews = brewsSince >= BACKUP_REMIND_BREWS;
  const reason = byDays ? `前回の書き出しから${daysSince}日たちました` : byBrews ? `前回の書き出しから${brewsSince}杯記録しました` : '';
  return { due: byDays || byBrews, never: false, daysSince, brewsSince, reason };
}

/** 最後の書き出しの1行「最後の書き出し：11/10（8日前）」 */
export function lastBackupText(lastBackupAt, now = new Date()) {
  const last = ms(lastBackupAt);
  if (last == null) return '最後の書き出し：まだありません';
  const ymd = localYmd(last);
  const days = daysBetween(ymd, localYmd(now)) ?? 0;
  const [, m, d] = ymd.split('-').map(Number);
  return `最後の書き出し：${m}/${d}（${days === 0 ? '今日' : `${days}日前`}）`;
}

/**
 * 飲み頃の帯：焙煎日を0日目として、4段階の幅（割合）と今日の位置（0〜1）。
 * 帯の右端は「早めに消費」に入ってから7日後。
 * @param {object|null} f freshness の結果
 * @returns {{segments:{stage:string, share:number}[], pos:number}|null}
 */
export function freshnessBand(f) {
  if (!f) return null;
  const w = f.window;
  const end = w.pastUntil + 8;
  const segs = [
    ['resting', w.restUntil + 1],
    ['peak', w.peakUntil - w.restUntil],
    ['past', w.pastUntil - w.peakUntil],
    ['useSoon', end - w.pastUntil - 1],
  ];
  const segments = segs.map(([stage, len]) => ({ stage, share: len / end }));
  // 日の真ん中に印を置く（0日目なら最初の1日の真ん中）
  const pos = Math.min(1, Math.max(0, (f.days + 0.5) / end));
  return { segments, pos };
}

/**
 * ホームに出す豆の行（飲み切り・入荷待ち・削除済みは出さない）。並びは豆の一覧と同じ。
 * 残量と残り杯数は常温＋冷凍の合計。常温が0で冷凍だけ残っている豆（frozenOnly）は、
 * 冷凍中は日数を数えないので「早めに消費」を出さない。
 * @param {{beans:object[], txs:object[], portions?:object[], doseG:number, today:string}} p
 * @returns {{bean:object, remainingG:number, roomG:number, frozenG:number, frozenCount:number, frozenOnly:boolean,
 *   cups:number, freshness:object|null, band:object|null, alerts:string[]}[]}
 */
export function beanRows({ beans = [], txs = [], portions = [], doseG, today }) {
  const byBean = groupTxByBean((txs ?? []).filter(alive));
  const portionsByBean = groupPortionsByBean(portions);
  return sortBeansForList((beans ?? []).filter((b) => alive(b) && b.status !== 'finished' && b.status !== 'ordered')).map((bean) => {
    const parts = stockParts(remainingG(byBean[bean.id] ?? []), portionsByBean[bean.id]);
    const cups = cupsLeft(parts.totalG, doseG);
    const frozenOnly = parts.roomG <= 0 && parts.frozenCount > 0;
    const f = freshness(bean.roastDate, bean.roastLevel, today);
    const alerts = [];
    if (cups <= LOW_STOCK_CUPS) alerts.push(cups === 0 ? 'empty' : 'low');
    if (f?.stage === 'useSoon' && !frozenOnly) alerts.push('useSoon');
    return {
      bean,
      remainingG: parts.totalG,
      roomG: parts.roomG,
      frozenG: parts.frozenG,
      frozenCount: parts.frozenCount,
      frozenOnly,
      cups,
      freshness: f,
      band: freshnessBand(f),
      alerts,
    };
  });
}

/** 在庫アラートの文「残り2杯」「早めに消費（焙煎から35日）」 */
export function alertText(row) {
  const parts = [];
  if (row.alerts.includes('empty')) parts.push('残りがありません（飲み切りにするか、量り直してください）');
  if (row.alerts.includes('low')) parts.push(`残り${row.cups}杯`);
  if (row.alerts.includes('useSoon')) parts.push(`早めに消費（焙煎から${row.freshness.days}日）`);
  return parts.join('・');
}

/**
 * 落ち切ってから評価を保存するまでの秒数（タイマーを使った抽出だけ）。
 * 落ち切った時刻はスタートの時刻＋総時間。30分を超えるもの（あとで評価した）は null
 */
export function recordSec(brew, tasting) {
  if (!brew?.timerUsed || !tasting) return null;
  const start = ms(brew.at);
  const saved = ms(tasting.createdAt);
  const total = brew.actual?.totalSec;
  if (start == null || saved == null || !(total > 0)) return null;
  const sec = Math.round((saved - (start + total * 1000)) / 1000);
  return sec >= 0 && sec <= RECORD_SEC_MAX ? sec : null;
}

/**
 * 直近の抽出（新しい順）と、その評価・記録にかかった秒数
 * @returns {{brew:object, tasting:object|null, recordSec:number|null}[]}
 */
export function recentBrews(brews = [], tastings = [], n = RECENT_BREWS) {
  return (brews ?? [])
    .filter(alive)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, n)
    .map((brew) => {
      const tasting = pickTasting(tastings, brew.id);
      return { brew, tasting, recordSec: recordSec(brew, tasting) };
    });
}

/**
 * 直近の抽出に出す「落ち切ってから評価を保存するまで」の文（2-8 の23番）。
 * 「記録 437秒」では意味が分からないので「評価まで 7分17秒」のように分と秒で出す
 * @param {number|null} sec recordSec の値
 */
export function recordText(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '';
  const s = Math.round(sec);
  if (s < 60) return `評価まで ${s}秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `評価まで ${m}分${r ? `${r}秒` : ''}`;
}

/**
 * 暑い日のカード（X16）の「急冷アイスで淹れる」の行き先：おすすめの1位 → 前回と同じ → レシピ帳（まだ淹れていない）
 * @param {{pickHref?:string|null, hasLast?:boolean}} p pickHref は todayPicks の1位の pickHref
 */
export function icedHref({ pickHref = null, hasLast = false } = {}) {
  if (pickHref) {
    const [path, query = ''] = pickHref.split('?');
    const q = new URLSearchParams(query);
    q.set('iced', '1');
    return `${path}?${q.toString()}`;
  }
  return hasLast ? 'brew.html?from=last&iced=1' : 'recipes.html';
}

/** 暑い日のカードの文（「最高気温31℃の予報です（東京都（新宿））」） */
export function hotText({ maxC, line, placeName = '' }) {
  return `${placeName ? `${placeName}は、` : ''}今日の最高気温${maxC}℃の予報です（線は${line}℃）。氷に直接落とす急冷アイスなら、香りを残したまま冷たく飲めます。`;
}
