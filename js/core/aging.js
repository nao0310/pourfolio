// エイジング日誌（X31）：同じ豆の焙煎後日数ごとの変化と、豆ごとの飲み頃の山（純粋関数）
// 山は保存せず、見るたびに計算する（評価を直すと変わるため。D-157 と同じ考え方、D-168）。
// 日数は抽出のときに記録した焙煎後日数（冷凍の袋は冷凍していた日を除いた日数）を使う。

import { DAY_BINS } from './factors.js';
import { mean } from './chart-scale.js';
import { roastGroup } from './roast.js';
import { FRESHNESS_WINDOWS, FALLBACK_GROUP } from './freshness.js';
import { JAR_ATTRS } from './tastings.js';
import { isIced } from './plan-adjust.js';

/** 日誌の折れ線と山を出す最少の杯数（★と日数のある杯） */
export const AGING_MIN = 3;
/** 山に数える区切りの最少の杯数 */
export const AGING_BIN_MIN = 2;

const r1 = (n) => Math.round(n * 10) / 10;
const num = (v) => (Number.isFinite(v) ? v : null);

/** 焙煎度の目安の飲み頃（「3〜10日」） */
export function standardWindow(level) {
  const g = roastGroup(level) ?? FALLBACK_GROUP;
  const w = FRESHNESS_WINDOWS[g] ?? FRESHNESS_WINDOWS[FALLBACK_GROUP];
  return { from: w.restUntil + 1, to: w.peakUntil, text: `${w.restUntil + 1}〜${w.peakUntil}日` };
}

/** 評価の「ちょうど良さ」のうち、ちょうどでない項目の短い言葉（「酸味 やや強い」） */
function jarNotes(jar) {
  if (!jar) return [];
  return JAR_ATTRS.filter((a) => Number.isFinite(jar[a.key]) && jar[a.key] !== 0).map((a) => `${a.label} ${a.words[jar[a.key] + 2]}`);
}

/**
 * 1つの豆の日誌。
 * @param {object[]} rows analysisRows の行のうち、この豆のもの
 * @returns {{ready:boolean, rated:number, entries:object[], bins:object[], peak:object|null, standard:object, line:string}}
 */
export function agingOf(bean, rows) {
  const withDays = (rows ?? []).filter((r) => r.bean?.id === bean.id && num(r.brew?.derived?.daysOffRoast) != null);
  const entries = withDays
    .map((r) => ({
      brewId: r.brew.id,
      at: r.at,
      days: r.brew.derived.daysOffRoast,
      stars: r.stars,
      iced: isIced(r.brew),
      frozen: Boolean(r.brew.frozenPortionId),
      tags: r.tasting?.tags ?? [],
      jar: jarNotes(r.tasting?.jar),
      memo: [r.tasting?.memo, r.brew.memo].filter((t) => t && String(t).trim()).join(' / '),
    }))
    .sort((a, b) => a.days - b.days || String(a.at).localeCompare(String(b.at)));
  const rated = entries.filter((e) => e.stars != null);
  const bins = DAY_BINS.map((b) => {
    const ys = rated.filter((e) => e.days >= b.from && e.days <= b.to).map((e) => e.stars);
    return { label: b.label, from: b.from, to: b.to, mid: Number.isFinite(b.to) ? (b.from + b.to) / 2 : b.from + 3, n: ys.length, mean: ys.length ? r1(mean(ys)) : null };
  });
  const withData = bins.filter((b) => b.n >= AGING_BIN_MIN);
  const ready = rated.length >= AGING_MIN;
  // 同じ平均なら日数の若い方（早く飲み頃になる方を山とする）
  const peak = ready && withData.length ? withData.reduce((a, b) => (b.mean > a.mean ? b : a)) : null;
  const standard = standardWindow(bean.roastLevel);
  return { bean, ready, rated: rated.length, cups: entries.length, entries, bins, peak, standard, line: agingLine({ ready, rated: rated.length, peak, standard }) };
}

/** 山の一文 */
export function agingLine({ ready, rated, peak, standard }) {
  if (!ready) return `焙煎後日数と★のある杯があと${AGING_MIN - rated}杯で、飲み頃の山を出します`;
  if (!peak) return `同じ日数の区切りで${AGING_BIN_MIN}杯ある所はまだありません（★のある杯 ${rated}杯）`;
  const inStd = peak.from <= standard.to && peak.to >= standard.from;
  return `飲み頃の山は ${peak.label}（平均★${peak.mean}・${peak.n}杯）。焙煎度の目安（${standard.text}）${inStd ? 'と重なっています' : 'とずれています'}`;
}

/**
 * 全部の豆の日誌（焙煎日数のある杯が1杯以上ある豆。山のある豆が先、その中で最後に淹れた順）。
 * @param {object[]} beans
 * @param {object[]} rows analysisRows の行
 */
export function agingAll(beans, rows) {
  const byBean = new Map();
  for (const r of rows ?? []) {
    if (!r.bean) continue;
    if (!byBean.has(r.bean.id)) byBean.set(r.bean.id, []);
    byBean.get(r.bean.id).push(r);
  }
  return (beans ?? [])
    .filter((b) => b && b.deletedAt == null && byBean.has(b.id))
    .map((b) => {
      const a = agingOf(b, byBean.get(b.id));
      return { ...a, lastAt: a.entries.length ? a.entries.reduce((m, e) => (String(e.at) > m ? String(e.at) : m), '') : '' };
    })
    .filter((a) => a.cups > 0)
    .sort((a, b) => Number(Boolean(b.peak)) - Number(Boolean(a.peak)) || b.lastAt.localeCompare(a.lastAt));
}
