// 表計算用のCSV書き出し（G1の残り、純粋関数）
// Excelで開いても文字化けしないよう、先頭にBOMを付けたUTF-8にし、行の区切りはCRLFにする。
// 2つのファイルを作る：抽出の一覧（1杯1行、豆・計画・実績・評価・提案を含む）と豆の一覧。

import { pickTasting, JAR_ATTRS, jarWord, DETAIL_ATTRS } from './tastings.js';
import { flavorsText } from './flavors.js';
import { precheckText } from './brews.js';
import { photoCount } from './photos.js';
import { pickSuggestionForBrew } from './dialin.js';
import { remainingG, cupsLeft, groupTxByBean } from './inventory.js';
import { freshness } from './freshness.js';
import { BEAN_STATUS, WEIGHT_BASIS, sortBeansForList } from './beans.js';
import { formatSec } from './recipes.js';
import { formatDateTimeJa } from './format.js';
import { groupPortionsByBean, stockParts } from './frozen.js';
import { brewCostJpy } from './cost.js';
import { retentionTable, brewMetrics } from './extraction.js';

export const BOM = '﻿';
const alive = (r) => r && r.deletedAt == null;

/** 1つの値をCSVの欄にする（カンマ・改行・「"」を含むときは "" で囲み、" は2つにする） */
export function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'boolean' ? (v ? 'はい' : 'いいえ') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 行の並びをCSVの文字列にする（先頭にBOM、行の区切りはCRLF） */
export function toCsv(rows) {
  return BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const ADOPTED = { true: '使った', false: '使わなかった' };

/**
 * 抽出の一覧（古い順、削除済みは除く）
 * 評価の列は主な評価（温かいうち）。熱いうち・冷めてからは★とメモだけを別の列に出す（B5）
 * @param {{brews:object[], beans?:object[], recipes?:object[], equipment?:object[], tastings?:object[], suggestions?:object[], photos?:object[], experiments?:object[]}} t
 * @returns {string[][]} 見出しの行を含む
 */
export function brewRows({ brews = [], beans = [], recipes = [], equipment = [], tastings = [], suggestions = [], photos = [], experiments = [] }) {
  const byId = (list) => new Map((list ?? []).map((r) => [r.id, r]));
  const beanOf = byId(beans);
  const recipeOf = byId(recipes);
  const eqOf = byId(equipment);
  const sugById = byId((suggestions ?? []).filter(alive));
  const expOf = byId((experiments ?? []).filter(alive));
  const table = retentionTable(brews);
  const head = [
    '日時',
    '豆',
    '焙煎度',
    '焙煎後日数',
    'レシピ',
    '計画 粉量g',
    '計画 湯量g',
    '計画 湯温℃',
    '計画 挽き目',
    '粉量g',
    '湯量g',
    '比率',
    '湯温℃',
    '挽き目',
    'グラインダー',
    '総時間秒',
    '総時間',
    '抽出液g',
    'TDS%',
    '抽出収率%',
    '推定抽出液g',
    'カフェインmg',
    '水',
    '原価円',
    '冷凍の袋',
    'タイマー',
    '抽出前チェック',
    '★',
    '一言',
    ...JAR_ATTRS.map((a) => a.label),
    '香味',
    '雑味',
    ...DETAIL_ATTRS.flatMap((a) => [`強さ ${a.label}`, `好み ${a.label}`]),
    '評価メモ',
    'ブラインド',
    '熱いうち★',
    '熱いうちのメモ',
    '冷めてから★',
    '冷めてからのメモ',
    '飲み比べ',
    '写真',
    'この杯への提案',
    '使った提案',
    '抽出メモ',
    '抽出ID',
  ];
  const rows = (brews ?? [])
    .filter(alive)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((b) => {
      const p = b.planned ?? {};
      const a = b.actual ?? {};
      const bean = beanOf.get(b.beanId);
      const t = pickTasting(tastings, b.id);
      const hot = pickTasting(tastings, b.id, 'hot');
      const cool = pickTasting(tastings, b.id, 'cool');
      const sug = pickSuggestionForBrew(suggestions, b.id);
      const used = b.suggestionId ? sugById.get(b.suggestionId) : null;
      const pGrind = typeof p.grind === 'string' ? p.grind : p.grind?.setting;
      const m = brewMetrics(b, table);
      return [
        formatDateTimeJa(b.at),
        bean?.name ?? '',
        bean?.roastLevel ?? '',
        b.derived?.daysOffRoast ?? '',
        recipeOf.get(b.recipeId)?.name ?? p.name ?? '',
        p.doseG ?? '',
        p.waterG ?? '',
        p.tempC ?? '',
        pGrind ?? '',
        a.doseG ?? '',
        a.waterG ?? '',
        b.derived?.ratio ?? '',
        a.tempC ?? '',
        a.grind?.setting ?? '',
        eqOf.get(a.grind?.grinderId ?? b.equipment?.grinderId)?.name ?? '',
        a.totalSec ?? '',
        a.totalSec != null ? formatSec(a.totalSec) : '',
        a.beverageG ?? '',
        m.tdsPct ?? '',
        m.eyPct ?? '',
        m.beverageEstimated ? (m.beverageG ?? '') : '',
        m.caffeineMg ?? '',
        eqOf.get(b.equipment?.waterId)?.name ?? '',
        brewCostJpy(b, bean, beans) ?? '',
        b.frozenPortionId ? '使った' : '',
        Boolean(b.timerUsed),
        precheckText(b.precheck),
        t?.stars ?? '',
        (t?.tags ?? []).join('・'),
        ...JAR_ATTRS.map((x) => (t?.jar?.[x.key] != null ? jarWord(x.key, t.jar[x.key]) : '')),
        flavorsText(t?.flavors),
        (t?.defects ?? []).join('・'),
        ...DETAIL_ATTRS.flatMap((x) => [t?.intensity?.[x.key] ?? '', t?.liking?.[x.key] ?? '']),
        t?.memo ?? '',
        t ? Boolean(t.blind) : '',
        hot?.stars ?? '',
        hot?.memo ?? '',
        cool?.stars ?? '',
        cool?.memo ?? '',
        expOf.get(b.experimentId)?.title ?? '',
        photoCount(photos, b.id) || '',
        sug ? [sug.action?.text, sug.adopted != null ? `（${ADOPTED[sug.adopted]}）` : ''].join('') : '',
        used?.action?.text ?? '',
        b.memo ?? '',
        b.id,
      ];
    });
  return [head, ...rows];
}

/**
 * 豆の一覧（飲み切りは後ろ、削除済みは除く）
 * 残量g・残り杯数は常温＋冷凍の合計。内訳を「常温g」「冷凍g」「冷凍の袋数」に出す
 * @param {{beans:object[], txs?:object[], portions?:object[], doseG:number, today:string}} p
 * @returns {string[][]}
 */
export function beanRowsCsv({ beans = [], txs = [], portions = [], doseG, today }) {
  const byBean = groupTxByBean((txs ?? []).filter(alive));
  const portionsByBean = groupPortionsByBean(portions);
  const head = [
    '名前',
    '購入先',
    '国',
    '地域',
    '農園',
    '品種',
    '精製',
    '焙煎度',
    '焙煎日',
    '表記重量g',
    '表記の基準',
    '実重量g',
    '価格円',
    '状態',
    '残量g',
    '残り杯数',
    '常温g',
    '冷凍g',
    '冷凍の袋数',
    '飲み頃',
    '焙煎後日数',
    'メモ',
    '商品URL',
    '豆ID',
  ];
  const rows = sortBeansForList((beans ?? []).filter(alive)).map((b) => {
    const parts = stockParts(remainingG(byBean[b.id] ?? []), portionsByBean[b.id]);
    const f = freshness(b.roastDate, b.roastLevel, today);
    return [
      b.name ?? '',
      b.shop ?? '',
      b.origin?.country ?? '',
      b.origin?.region ?? '',
      b.origin?.farm ?? '',
      b.variety ?? '',
      b.process ?? '',
      b.roastLevel ?? '',
      b.roastDate ?? '',
      b.labelWeightG ?? '',
      WEIGHT_BASIS[b.labelWeightBasis] ?? '',
      b.actualWeightG ?? '',
      b.priceJpy ?? '',
      BEAN_STATUS[b.status] ?? '',
      parts.totalG,
      cupsLeft(parts.totalG, doseG),
      parts.roomG,
      parts.frozenG,
      parts.frozenCount,
      f?.label ?? '',
      f?.days ?? '',
      b.memo ?? '',
      b.productUrl ?? '',
      b.id,
    ];
  });
  return [head, ...rows];
}

const pad2 = (n) => String(n).padStart(2, '0');

/** CSVのファイル名（例：pourfolio-brews-20261118-0742.csv） */
export function csvFileName(kind, now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return `pourfolio-${kind}-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.csv`;
}
