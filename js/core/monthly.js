// 月次レポート（X4）：1か月の杯数・ベスト3・飲んだ産地・支出・好みの変化（純粋関数）
// A4 の1枚に印刷して PDF にもできる（report.html）。日付は端末の時刻（localYmd）で区切る。

import { analysisRows } from './analysis.js';
import { monthlySpending, addMonths } from './cost.js';
import { localYmd } from './format.js';
import { mean } from './chart-scale.js';
import { myCaffeineMg } from './caffeine.js';

/** 好みの変化に使う、1つの焙煎度あたりの最少の杯 */
export const PREF_MIN_CUPS = 2;
/** 最多の産地を何件まで出すか */
export const ORIGIN_TOP = 6;

const r1 = (n) => Math.round(n * 10) / 10;
const monthOfYmd = (ymd) => String(ymd ?? '').slice(0, 7);

/** 「2026-11」→「2026年11月」 */
export function monthLabel(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return `${y}年${m}月`;
}

/** 'YYYY-MM' として正しいか */
export function isMonth(ym) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym ?? ''));
}

/** 焙煎度ごとの平均★（PREF_MIN_CUPS 杯以上）のいちばん高いもの */
function bestRoast(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.bean?.roastLevel;
    if (!k || r.stars == null) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r.stars);
  }
  const list = [...by.entries()].filter(([, s]) => s.length >= PREF_MIN_CUPS).map(([key, s]) => ({ key, avg: r1(mean(s)), n: s.length }));
  return list.sort((a, b) => b.avg - a.avg || b.n - a.n)[0] ?? null;
}

/**
 * 月次レポートの中身
 * @param {{brews?:object[], beans?:object[], tastings?:object[], orders?:object[], month:string}} p
 */
export function monthlyReport({ brews = [], beans = [], tastings = [], orders = [], month }) {
  const all = analysisRows({ brews, beans, tastings });
  const rows = all.filter((r) => monthOfYmd(r.ymd) === month);
  const prevMonth = addMonths(month, -1);
  const prev = all.filter((r) => monthOfYmd(r.ymd) === prevMonth);
  const rated = rows.filter((r) => r.stars != null);
  const prevRated = prev.filter((r) => r.stars != null);

  const best = [...rated].sort((a, b) => b.stars - a.stars || String(b.at).localeCompare(String(a.at))).slice(0, 3);

  const origins = new Map();
  for (const r of rows) {
    const k = r.bean?.origin?.country || '産地なし';
    origins.set(k, (origins.get(k) ?? 0) + 1);
  }
  const originList = [...origins.entries()].map(([key, cups]) => ({ key, cups })).sort((a, b) => b.cups - a.cups || a.key.localeCompare(b.key, 'ja'));

  // 支出は月の最後の日を「今日」として、その月の行だけを使う
  const spend = monthlySpending({ beans, orders, brews, today: `${month}-28`, months: 1 })[0];

  const caf = rows.reduce((a, r) => a + (myCaffeineMg(r) ?? 0), 0);
  const days = new Set(rows.map((r) => r.ymd)).size;
  const avg = rated.length ? r1(mean(rated.map((r) => r.stars))) : null;
  const prevAvg = prevRated.length ? r1(mean(prevRated.map((r) => r.stars))) : null;

  return {
    month,
    label: monthLabel(month),
    cups: rows.length,
    days,
    beansUsed: new Set(rows.map((r) => r.brew.beanId).filter(Boolean)).size,
    avgStars: avg,
    prevAvgStars: prevAvg,
    caffeinePerDayMg: days ? Math.round(caf / days) : null,
    best: best.map((r) => ({ brewId: r.brew.id, ymd: r.ymd, stars: r.stars, beanName: r.bean?.name ?? '豆なし', roastLevel: r.bean?.roastLevel ?? '', ratio: r.metrics.ratio })),
    origins: originList.slice(0, ORIGIN_TOP),
    otherOrigins: Math.max(0, originList.length - ORIGIN_TOP),
    spend: { boughtJpy: spend.boughtJpy, bags: spend.bags, unpricedBags: spend.unpricedBags, drankJpy: spend.drankJpy, uncostedCups: spend.uncostedCups },
    prefChange: prefChangeText({ now: bestRoast(rows), before: bestRoast(prev), avg, prevAvg }),
  };
}

/** 好みの変化の文（先月と比べる） */
export function prefChangeText({ now, before, avg, prevAvg }) {
  const lines = [];
  if (avg != null && prevAvg != null) {
    const d = r1(avg - prevAvg);
    lines.push(d === 0 ? `平均の★は先月と同じ${avg}でした` : `平均の★は先月の${prevAvg}から${avg}に${d > 0 ? '上がりました' : '下がりました'}`);
  }
  if (now && before) {
    lines.push(now.key === before.key ? `いちばん好きな焙煎度は先月と同じ「${now.key}」（★${now.avg}）` : `いちばん好きな焙煎度が「${before.key}」から「${now.key}」（★${now.avg}）に変わりました`);
  } else if (now) {
    lines.push(`今月いちばん★が高かった焙煎度は「${now.key}」（★${now.avg}、${now.n}杯）`);
  }
  if (!lines.length) lines.push(`比べるには、焙煎度ごとに★の付いた杯が${PREF_MIN_CUPS}杯以上いります`);
  return lines;
}

/** 記録のある月（新しい順）。今月は記録がなくても入れる */
export function reportMonths(brews = [], today = localYmd()) {
  const set = new Set([monthOfYmd(today)]);
  for (const b of brews) if (b && b.deletedAt == null) set.add(monthOfYmd(localYmd(b.at)));
  return [...set].filter(isMonth).sort().reverse();
}
