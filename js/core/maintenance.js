// 器具のお手入れ（D4、純粋関数）
// お手入れの設定は器具の記録に maintenance として持つ（DBの版は変えない、D-171）。
//   { enabled, everyDays, everyCups, lastDoneAt, snoozedUntil, log: [済んだ日時…] }
// 設定のない器具（3-5 より前の記録）は種類ごとの初期値で読み、前回は登録した日とみなす。

import { parseNumber, isValidYmd } from './beans.js';
import { localYmd } from './format.js';

/** お手入れのある種類と、その初期値 */
export const MAINTENANCE_DEFAULTS = Object.freeze({
  grinder: Object.freeze({ label: '刃の掃除', everyDays: 30, everyCups: 50, how: 'ブラシで刃と粉の通り道の粉を払います。分解したらゼロ点を確かめます' }),
  kettle: Object.freeze({ label: '除石灰', everyDays: 60, everyCups: null, how: '水にクエン酸（1Lに小さじ1ほど）を入れて沸かし、しばらく置いてからすすぎます' }),
});
export const MAINTENANCE_KINDS = Object.freeze(Object.keys(MAINTENANCE_DEFAULTS));

/** 入れられる間隔の範囲 */
export const DAYS_RANGE = Object.freeze({ min: 1, max: 365 });
export const CUPS_RANGE = Object.freeze({ min: 1, max: 1000 });
/** 「あとで」で知らせを止める日数 */
export const SNOOZE_DAYS = 3;
/** 済んだ日時を残す数 */
export const LOG_MAX = 12;
/** 時期が近いとみなす割合（一覧に「もうすぐ」と出す） */
export const SOON_RATIO = 0.8;

const DAY_MS = 86400000;
const alive = (r) => r && r.deletedAt == null;
const toMs = (v) => {
  const ms = new Date(v ?? NaN).getTime();
  return Number.isFinite(ms) ? ms : null;
};
const posInt = (v, { min, max }) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

/** お手入れのある器具か */
export function hasMaintenance(eq) {
  return MAINTENANCE_KINDS.includes(eq?.kind);
}

/**
 * 器具のお手入れの設定を読む（ない項目は初期値）。お手入れのない種類は null
 * @returns {{label:string, how:string, enabled:boolean, everyDays:number|null, everyCups:number|null, lastDoneAt:string|null, snoozedUntil:string|null, log:string[]}|null}
 */
export function maintenanceOf(eq) {
  if (!hasMaintenance(eq)) return null;
  const d = MAINTENANCE_DEFAULTS[eq.kind];
  const m = eq.maintenance && typeof eq.maintenance === 'object' ? eq.maintenance : {};
  const has = (k) => Object.hasOwn(m, k);
  return {
    label: d.label,
    how: d.how,
    enabled: has('enabled') ? m.enabled !== false : true,
    everyDays: has('everyDays') ? posInt(m.everyDays, DAYS_RANGE) : d.everyDays,
    everyCups: has('everyCups') ? posInt(m.everyCups, CUPS_RANGE) : d.everyCups,
    lastDoneAt: toMs(m.lastDoneAt) != null ? new Date(m.lastDoneAt).toISOString() : null,
    snoozedUntil: toMs(m.snoozedUntil) != null ? new Date(m.snoozedUntil).toISOString() : null,
    log: Array.isArray(m.log) ? m.log.filter((x) => toMs(x) != null) : [],
  };
}

/** その杯でその器具を使ったか（グラインダーは挽き目の記録も見る） */
export function brewUsesEquipment(brew, eq) {
  if (!brew || !eq) return false;
  const e = brew.equipment ?? {};
  if (eq.kind === 'grinder') {
    return [e.grinderId, brew.actual?.grind?.grinderId, brew.planned?.grind?.grinderId].includes(eq.id);
  }
  return e[`${eq.kind}Id`] === eq.id;
}

/**
 * お手入れの状態
 * @param {object} eq 器具
 * @param {object[]} brews 抽出（削除の印が付いたものは数えない）
 * @param {Date|string|number} now
 * @returns {null|{eq:object, label:string, how:string, enabled:boolean, everyDays:number|null, everyCups:number|null,
 *   sinceAt:string|null, sinceDone:boolean, days:number|null, cups:number, due:boolean, soon:boolean, snoozed:boolean,
 *   daysLeft:number|null, cupsLeft:number|null, why:string}}
 */
export function maintenanceStatus(eq, brews = [], now = new Date()) {
  const m = maintenanceOf(eq);
  if (!m || !alive(eq)) return null;
  const nowMs = toMs(now) ?? Date.now();
  // 前回：済んだ日時がなければ器具を登録した日から数える
  const sinceMs = toMs(m.lastDoneAt) ?? toMs(eq.createdAt);
  const days = sinceMs != null ? Math.max(0, Math.floor((nowMs - sinceMs) / DAY_MS)) : null;
  const cups = (brews ?? []).filter((b) => {
    if (!alive(b) || !brewUsesEquipment(b, eq)) return false;
    const at = toMs(b.at);
    return at != null && (sinceMs == null || at > sinceMs) && at <= nowMs;
  }).length;
  const byDays = m.everyDays != null && days != null && days >= m.everyDays;
  const byCups = m.everyCups != null && cups >= m.everyCups;
  const snoozed = toMs(m.snoozedUntil) != null && toMs(m.snoozedUntil) > nowMs;
  const reached = m.enabled && (byDays || byCups);
  const daysLeft = m.everyDays != null && days != null ? m.everyDays - days : null;
  const cupsLeft = m.everyCups != null ? m.everyCups - cups : null;
  const soon =
    m.enabled &&
    !reached &&
    ((m.everyDays != null && days != null && days >= m.everyDays * SOON_RATIO) || (m.everyCups != null && cups >= m.everyCups * SOON_RATIO));
  return {
    eq,
    label: m.label,
    how: m.how,
    enabled: m.enabled,
    everyDays: m.everyDays,
    everyCups: m.everyCups,
    sinceAt: sinceMs != null ? new Date(sinceMs).toISOString() : null,
    sinceDone: m.lastDoneAt != null,
    days,
    cups,
    due: reached && !snoozed,
    reached,
    soon,
    snoozed: reached && snoozed,
    daysLeft,
    cupsLeft,
    why: reached ? dueWhy({ sinceDone: m.lastDoneAt != null, days, cups, withCups: m.everyCups != null }) : '',
  };
}

function dueWhy({ sinceDone, days, cups, withCups }) {
  const from = sinceDone ? '前回から' : '登録から';
  const parts = [];
  if (days != null) parts.push(`${days}日`);
  if (withCups) parts.push(`${cups}杯`);
  return `${from}${parts.join('・')}`;
}

/**
 * ホームに出すお手入れ（時期が来たもの。日数の過ぎた順）
 * @returns {ReturnType<typeof maintenanceStatus>[]}
 */
export function dueMaintenance(equipment = [], brews = [], now = new Date()) {
  return (equipment ?? [])
    .map((eq) => maintenanceStatus(eq, brews, now))
    .filter((s) => s?.due)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || (a.cupsLeft ?? 0) - (b.cupsLeft ?? 0));
}

/** 器具の一覧に出す1行「刃の掃除：あと12日か18杯」 */
export function maintenanceLine(s) {
  if (!s) return '';
  if (!s.enabled) return `${s.label}：知らせない`;
  if (s.reached) return `${s.label}：時期です（${s.why}）`;
  const left = [];
  if (s.daysLeft != null) left.push(`${s.daysLeft}日`);
  if (s.cupsLeft != null) left.push(`${s.cupsLeft}杯`);
  return left.length ? `${s.label}：あと${left.join('か')}${s.soon ? '（もうすぐ）' : ''}` : `${s.label}：間隔を決めていません`;
}

/** 「済んだ」：前回を今にして、知らせの停止を消し、日時を残す */
export function markDone(maintenance, now = new Date()) {
  const m = maintenance && typeof maintenance === 'object' ? maintenance : {};
  const at = new Date(now).toISOString();
  const log = [at, ...(Array.isArray(m.log) ? m.log : [])].slice(0, LOG_MAX);
  return { ...m, lastDoneAt: at, snoozedUntil: null, log };
}

/** 「あとで」：SNOOZE_DAYS 日は知らせない */
export function snooze(maintenance, now = new Date(), days = SNOOZE_DAYS) {
  const m = maintenance && typeof maintenance === 'object' ? maintenance : {};
  return { ...m, snoozedUntil: new Date(new Date(now).getTime() + days * DAY_MS).toISOString() };
}

/**
 * 器具の編集画面のお手入れの欄を読む
 * @param {{mtEnabled?:string|boolean, mtDays?:string, mtCups?:string, mtLast?:string}} raw mtLast は YYYY-MM-DD（空なら変えない）
 * @param {string} kind 器具の種類
 * @returns {{value: {enabled:boolean, everyDays:number|null, everyCups:number|null, lastDoneYmd:string|null}|null, errors: Record<string,string>}}
 */
export function normalizeMaintenanceInput(raw = {}, kind) {
  if (!MAINTENANCE_KINDS.includes(kind)) return { value: null, errors: {} };
  const errors = {};
  const enabled = raw.mtEnabled === 'on' || raw.mtEnabled === true;
  const read = (key, range, label) => {
    const n = parseNumber(raw[key]);
    if (n == null) return null;
    if (!Number.isInteger(n) || n < range.min || n > range.max) {
      errors[key] = `${label}は${range.min}〜${range.max}の整数で入れてください`;
      return null;
    }
    return n;
  };
  const everyDays = read('mtDays', DAYS_RANGE, '日数');
  const everyCups = read('mtCups', CUPS_RANGE, '杯数');
  if (enabled && everyDays == null && everyCups == null && !errors.mtDays && !errors.mtCups) {
    errors.mtDays = '日数か杯数のどちらかを入れてください';
  }
  const last = String(raw.mtLast ?? '').trim();
  let lastDoneYmd = null;
  if (last) {
    if (!isValidYmd(last)) errors.mtLast = '日付を選んでください';
    else lastDoneYmd = last;
  }
  return { value: { enabled, everyDays, everyCups, lastDoneYmd }, errors };
}

/**
 * 編集画面の値を、今の設定に重ねる（済んだ日時の記録や「あとで」は残す）。
 * 前回の日を入れ直したら、その日の正午を前回にする（同じ日なら時刻を変えない）
 */
export function mergeMaintenance(current, input) {
  const m = current && typeof current === 'object' ? current : {};
  if (!input) return m;
  const next = { ...m, enabled: input.enabled, everyDays: input.everyDays, everyCups: input.everyCups };
  if (input.lastDoneYmd) {
    const curYmd = toMs(m.lastDoneAt) != null ? localYmd(m.lastDoneAt) : null;
    if (curYmd !== input.lastDoneYmd) {
      next.lastDoneAt = new Date(`${input.lastDoneYmd}T12:00:00`).toISOString();
      next.snoozedUntil = null;
    }
  }
  return next;
}

/** 編集画面に入れる値 */
export function maintenanceToFormValues(eq) {
  const m = maintenanceOf(eq);
  if (!m) return {};
  return {
    mtEnabled: m.enabled,
    mtDays: m.everyDays == null ? '' : String(m.everyDays),
    mtCups: m.everyCups == null ? '' : String(m.everyCups),
    mtLast: m.lastDoneAt ? localYmd(m.lastDoneAt) : '',
  };
}
