// カレンダーとカフェイン（E8）：毎日の杯数と、カフェインの目安の推移（純粋関数）
// 日付は端末の時刻（localYmd）で区切る。カフェインは extraction.js の目安。

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** 'YYYY-MM-DD' に日数を足す（時差の影響を受けないよう UTC で計算） */
export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return ymdOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * 日ごとの集計。
 * @param {object[]} rows analysisRows の結果
 * @returns {Map<string, {cups:number, caffeineMg:number, unknown:number}>} unknown はカフェインを出せなかった杯
 */
export function dailyStats(rows) {
  const out = new Map();
  for (const r of rows) {
    const s = out.get(r.ymd) ?? { cups: 0, caffeineMg: 0, unknown: 0 };
    s.cups += 1;
    if (r.metrics.caffeineMg != null) s.caffeineMg += r.metrics.caffeineMg;
    else s.unknown += 1;
    out.set(r.ymd, s);
  }
  return out;
}

/** 杯数を色の濃さ 0〜4 にする（0杯＝0、4杯以上＝4） */
export function cupLevel(cups) {
  return Math.min(4, Math.max(0, cups | 0));
}

/**
 * 月のカレンダー（日曜はじまり）。週ごとに7日。月の外の日は inMonth:false。
 * @param {number} year
 * @param {number} month 1〜12
 * @param {Map} stats dailyStats の結果
 */
export function monthGrid(year, month, stats = new Map()) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = addDays(ymdOf(year, month, 1), -first.getUTCDay());
  const weeks = [];
  let cur = start;
  const last = ymdOf(year, month, days);
  while (weeks.length === 0 || cur <= last) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const s = stats.get(cur);
      const [, m, d] = cur.split('-').map(Number);
      week.push({ ymd: cur, day: d, inMonth: m === month, cups: s?.cups ?? 0, caffeineMg: s?.caffeineMg ?? 0, level: cupLevel(s?.cups ?? 0) });
      cur = addDays(cur, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** 前後の月 { year, month } */
export function shiftMonth(year, month, delta) {
  const t = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 };
}

/**
 * 直近 n 日（今日を含む、古い順）のカフェインと杯数。
 * @returns {{ymd:string, cups:number, caffeineMg:number}[]}
 */
export function lastDays(stats, todayYmd, n = 30) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ymd = addDays(todayYmd, -i);
    const s = stats.get(ymd);
    out.push({ ymd, cups: s?.cups ?? 0, caffeineMg: s?.caffeineMg ?? 0 });
  }
  return out;
}

/**
 * 直近の要約：飲んだ日の平均カフェイン・いちばん多かった日・1日の平均杯数・今日の量
 */
export function caffeineSummary(days) {
  const drank = days.filter((d) => d.cups > 0);
  const today = days[days.length - 1] ?? null;
  if (!drank.length) return { drankDays: 0, avgMg: null, maxDay: null, avgCups: null, todayMg: today?.caffeineMg ?? 0 };
  const sum = drank.reduce((a, d) => a + d.caffeineMg, 0);
  const cups = drank.reduce((a, d) => a + d.cups, 0);
  const maxDay = drank.reduce((a, d) => (d.caffeineMg > a.caffeineMg ? d : a));
  return {
    drankDays: drank.length,
    avgMg: Math.round(sum / drank.length),
    maxDay,
    avgCups: Math.round((cups / drank.length) * 10) / 10,
    todayMg: today?.caffeineMg ?? 0,
  };
}
