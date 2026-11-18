// 分析（E2〜E8）の共通部分：抽出・豆・評価をつないだ行と、画面ごとの「使えるようになる目安」（純粋関数）
// データが少ないうちは「あと○杯で表示」と出し、途中の結果を断定しない（spec 5.3）。

import { pickTasting } from './tastings.js';
import { retentionTable, brewMetrics } from './extraction.js';
import { localYmd } from './format.js';

const alive = (r) => r && r.deletedAt == null;

/** 画面ごとの目安（spec 5.2）。key は分析の画面 */
export const THRESHOLDS = Object.freeze({
  dialin: 3, // ダイヤルインの道のり：1つの豆で3杯
  chart: 1, // 抽出チャート：TDS付きの杯が1杯あれば点を出す
  zone: 10, // 自分の好きゾーン：TDS付きで★のある杯が10杯
  factors: 20, // 条件と評価：★のある杯が20杯
  roastCurveBags: 5, // 飲み頃カーブ：同じ焙煎度で5袋
  profile: 30, // 嗜好プロファイル：★のある杯が30杯
  liking: 20, // 味の好みの位置：詳細評価が20件
});

/**
 * 抽出1杯ごとに、豆・主な評価（温かいうち）・計算値をつないだ行（古い順、削除済みは除く）。
 * @param {{brews?:object[], beans?:object[], tastings?:object[]}} data
 * @returns {{brew:object, bean:object|null, tasting:object|null, stars:number|null, metrics:object, at:string, ymd:string}[]}
 */
export function analysisRows({ brews = [], beans = [], tastings = [] } = {}) {
  const live = (brews ?? []).filter(alive);
  const table = retentionTable(live);
  const beanOf = new Map((beans ?? []).filter(alive).map((b) => [b.id, b]));
  return live
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((brew) => {
      const tasting = pickTasting(tastings ?? [], brew.id);
      return {
        brew,
        bean: beanOf.get(brew.beanId) ?? null,
        tasting,
        stars: Number.isFinite(tasting?.stars) ? tasting.stars : null,
        metrics: brewMetrics(brew, table),
        at: brew.at,
        ymd: localYmd(brew.at),
      };
    });
}

/** ★のある行だけ */
export const ratedRows = (rows) => rows.filter((r) => r.stars != null);

/** 目安に届いたか。届いていなければ「あと○杯」 */
export function readiness(have, need) {
  const n = Math.max(0, have | 0);
  return n >= need ? { ready: true, have: n, need, left: 0 } : { ready: false, have: n, need, left: need - n };
}

/** 「あと3杯で表示します（いま7杯）」 */
export function readinessText(r, unit = '杯') {
  return r.ready ? '' : `あと${r.left}${unit}で表示します（いま${r.have}${unit}）`;
}

/** 件数から信頼度の言葉（5件未満は「低」、15件未満は「中」、それ以上は「高」） */
export function confidenceOf(n) {
  if (n >= 15) return { level: 'high', text: '高' };
  if (n >= 5) return { level: 'mid', text: '中' };
  return { level: 'low', text: '低' };
}
