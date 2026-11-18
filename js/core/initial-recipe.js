// 新しい豆の初期レシピ（F2、spec 6.3）：似た豆の成功例 → 焙煎度の区分の「自分の初期値」→ 焙煎度の叩き台 の順に選ぶ（純粋関数）
// 決めるのは粉量・比率・湯温・挽き目の4つ。注湯の形は土台のレシピ（いちばん使っているレシピ）から写す。

import { ROAST_LEVELS, roastGroup } from './roast.js';
import { ratioOf, planFromRecipe, applyTemplate, make46, DEFAULT_RATIO } from './recipes.js';
import { applyOverrides, isIced, cupsOf } from './plan-adjust.js';
import { pickTasting } from './tastings.js';
import { convertSetting, scaleOf, settingFor, sizeWord, umAt } from './grinder-scale.js';
import { parseNumber } from './beans.js';

const alive = (r) => r && r.deletedAt == null;
const clean = (v) => String(v ?? '').normalize('NFKC').trim();
const round1 = (n) => Math.round(n * 10) / 10;

/** 成功例とみなす★ */
export const GOOD_STARS = 4;
/** 似た豆の成功例をいくつ集めたら使うか */
export const SIMILAR_MIN_BREWS = 2;
/** 焙煎度の区分の「自分の初期値」に切り替える、★のある杯の数（そのうち★4以上が2杯以上） */
export const OWN_MIN_RATED = 5;
export const OWN_MIN_GOOD = 2;
/** 似た豆とみなす点数（焙煎度が同じ＝3、1段違い＝2、精製・産地が同じ＝各2、品種が同じ＝1） */
export const SIMILAR_MIN_SCORE = 4;

/**
 * 焙煎度の叩き台（spec 6.3 の表。幅のある値は真ん中）。um は挽き目の目安の粒度
 */
export const ROAST_TABLE = Object.freeze([
  { key: 'light', label: 'ライト〜ミディアム', levels: ['ライト', 'シナモン', 'ミディアム'], tempC: 93, ratio: 15.5, um: 650, grindWord: '中細挽き' },
  { key: 'mid', label: 'ハイ〜シティ', levels: ['ハイ', 'シティ'], tempC: 90, ratio: 15, um: 850, grindWord: '中挽き' },
  { key: 'dark', label: 'フルシティ〜イタリアン', levels: ['フルシティ', 'フレンチ', 'イタリアン'], tempC: 87, ratio: 14.5, um: 950, grindWord: '中挽き〜やや粗め' },
]);

/** 焙煎度の叩き台の行（焙煎度がわからなければ真ん中の行） */
export function tableRow(level) {
  return ROAST_TABLE.find((r) => r.levels.includes(level)) ?? ROAST_TABLE[1];
}

/** 中央値（空なら null） */
export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * 2つの豆の似ている度合い。焙煎度が2段以上違えば 0（抽出の仕方が大きく変わるため）
 * @returns {{score:number, why:string[]}}
 */
export function similarity(a, b) {
  const ia = ROAST_LEVELS.indexOf(a?.roastLevel);
  const ib = ROAST_LEVELS.indexOf(b?.roastLevel);
  if (ia < 0 || ib < 0 || Math.abs(ia - ib) > 1) return { score: 0, why: [] };
  const why = [];
  let score = ia === ib ? 3 : 2;
  why.push(ia === ib ? '焙煎度が同じ' : '焙煎度が1段違い');
  const same = (x, y) => clean(x) !== '' && clean(x) === clean(y);
  if (same(a.process, b.process)) {
    score += 2;
    why.push('精製が同じ');
  }
  if (same(a.origin?.country, b.origin?.country)) {
    score += 2;
    why.push('産地が同じ');
  }
  if (same(a.variety, b.variety)) {
    score += 1;
    why.push('品種が同じ');
  }
  return { score, why };
}

/** 豆ごとの成功例（★4以上、アイスでない、温かいうちの評価）。新しい順 */
function goodBrews(brews, tastings, beanIds) {
  return brews
    .filter((b) => alive(b) && beanIds.has(b.beanId) && !isIced(b))
    .map((b) => ({ brew: b, stars: pickTasting(tastings, b.id)?.stars ?? null }))
    .filter((x) => x.stars != null);
}

/**
 * 杯の挽き目を、使うグラインダーの目盛り（数）にそろえる。違うグラインダーは目盛り表で換算する
 * @returns {number|null}
 */
function grindOn(brew, grinderId, grinders) {
  const g = brew.actual?.grind ?? brew.planned?.grind ?? {};
  const setting = typeof g === 'string' ? g : g.setting;
  const from = (typeof g === 'object' && g.grinderId) || brew.equipment?.grinderId || null;
  const n = parseNumber(setting);
  if (n == null || Number.isNaN(n)) return null;
  if (!grinderId || from === grinderId) return n;
  const conv = convertSetting(grinders.find((x) => x.id === from), n, grinders.find((x) => x.id === grinderId));
  return conv ? conv.setting : null;
}

/** 杯の集まりから中央値の4つの値 */
function medians(list, grinderId, grinders, step) {
  const brews = list.map((x) => x.brew);
  const doseG = median(brews.map((b) => (b.actual?.doseG ?? b.planned?.doseG) / cupsOf(b))); // 杯数を変えた杯は1杯分（2-8 の7番）
  const ratio = median(brews.map((b) => ratioOf(b.actual?.doseG, b.actual?.waterG) ?? ratioOf(b.planned?.doseG, b.planned?.waterG)));
  const tempC = median(brews.map((b) => b.actual?.tempC ?? b.planned?.tempC));
  const g = median(brews.map((b) => grindOn(b, grinderId, grinders)));
  const st = step > 0 ? step : 1;
  return {
    doseG: doseG != null ? round1(doseG) : null,
    ratio: ratio != null ? round1(ratio) : null,
    tempC: tempC != null ? Math.round(tempC) : null,
    grindSetting: g != null ? Number((Math.round(g / st) * st).toFixed(4)) : null,
  };
}

/**
 * 新しい豆の初期レシピ（4つの値と理由）を選ぶ。
 * @param {{bean:object, beans?:object[], brews?:object[], tastings?:object[], grinders?:object[], grinderId?:string|null, defaultDoseG?:number}} p
 *   grinderId は使うグラインダー（土台のレシピか「いつも使う」）
 * @returns {{source:'similar'|'own'|'table', doseG:number, ratio:number, tempC:number, grind:{grinderId:string|null, setting:string, word:string}, reasons:string[], similar:{bean:object, score:number, why:string[]}[], n:number}}
 */
export function initialRecipe({ bean, beans = [], brews = [], tastings = [], grinders = [], grinderId = null, defaultDoseG = 15 }) {
  const grinder = grinders.find((g) => g.id === grinderId) ?? null;
  const step = grinder?.attrs?.step ?? 1;
  const row = tableRow(bean?.roastLevel);
  const others = beans.filter((b) => alive(b) && b.id !== bean?.id);

  // 1. 似た豆の成功例
  const similar = others
    .map((b) => ({ bean: b, ...similarity(bean, b) }))
    .filter((x) => x.score >= SIMILAR_MIN_SCORE)
    .sort((a, b) => b.score - a.score || String(b.bean.updatedAt ?? '').localeCompare(String(a.bean.updatedAt ?? '')))
    .slice(0, 5);
  const simGood = goodBrews(brews, tastings, new Set(similar.map((x) => x.bean.id))).filter((x) => x.stars >= GOOD_STARS);
  if (simGood.length >= SIMILAR_MIN_BREWS) {
    const m = medians(simGood, grinderId, grinders, step);
    const used = similar.filter((x) => simGood.some((g) => g.brew.beanId === x.bean.id));
    const top = used[0];
    const names = [...new Set(used.map((x) => x.bean.name))]; // 同じ銘柄を買い直した袋は1つの名前にまとめる
    return finish({
      source: 'similar',
      m,
      row,
      grinder,
      defaultDoseG,
      n: simGood.length,
      similar: used,
      reasons: [
        `似た豆 ${used.length}袋（${names.slice(0, 3).join('、')}${names.length > 3 ? ' ほか' : ''}）で★${GOOD_STARS}以上だった${simGood.length}杯の中央値です`,
        top ? `いちばん似ている豆：${top.bean.name}（${top.why.join('・')}）` : '',
      ],
    });
  }

  // 2. 焙煎度の区分の「自分の初期値」
  const group = roastGroup(bean?.roastLevel);
  if (group) {
    const ids = new Set(others.filter((b) => roastGroup(b.roastLevel) === group).map((b) => b.id));
    const rated = goodBrews(brews, tastings, ids);
    const good = rated.filter((x) => x.stars >= GOOD_STARS);
    if (rated.length >= OWN_MIN_RATED && good.length >= OWN_MIN_GOOD) {
      const m = medians(good, grinderId, grinders, step);
      return finish({
        source: 'own',
        m,
        row,
        grinder,
        defaultDoseG,
        n: good.length,
        similar: [],
        reasons: [`似た豆の成功例がまだ少ないので、同じ焙煎度の区分で★${GOOD_STARS}以上だった${good.length}杯の中央値（自分の初期値）です`],
      });
    }
  }

  // 3. 焙煎度の叩き台
  return finish({
    source: 'table',
    m: { doseG: null, ratio: null, tempC: null, grindSetting: null },
    row,
    grinder,
    defaultDoseG,
    n: 0,
    similar: [],
    reasons: [
      `似た豆の成功例がまだないので、焙煎度（${bean?.roastLevel || '不明'}）の叩き台（${row.label}：${row.tempC}℃・1:${row.ratio}・${row.grindWord}）を使います`,
      '評価が貯まると、自分の記録から決めた値に置き換わります',
    ],
  });
}

/** 足りない値を叩き台で補い、挽き目を目盛りにする */
function finish({ source, m, row, grinder, defaultDoseG, n, similar, reasons }) {
  let setting = m.grindSetting != null ? String(m.grindSetting) : '';
  let word = row.grindWord;
  if (!setting && grinder) {
    const s = settingFor(scaleOf(grinder), row.um, grinder.attrs?.step ?? 1);
    if (s) setting = String(s.setting);
  }
  if (setting && grinder) {
    // 目盛り表があれば、実際の値の言葉にする
    const at = umAt(scaleOf(grinder), setting);
    if (at) word = sizeWord(at.um);
  }
  const notes = reasons.filter(Boolean);
  if (!setting) notes.push(`挽き目は「${word}」を目安に、目盛りを手で合わせてください（グラインダーの目盛り表があれば数字で出せます）`);
  return {
    source,
    doseG: m.doseG ?? defaultDoseG,
    ratio: m.ratio ?? row.ratio,
    tempC: m.tempC ?? row.tempC,
    grind: { grinderId: grinder?.id ?? null, setting, word },
    reasons: notes,
    similar,
    n,
  };
}

/**
 * いちばん使っているレシピ（土台にする）。お気に入り → 使った回数 → 新しい順。なければ null
 */
export function baseRecipe(recipes = [], brews = []) {
  const count = {};
  for (const b of brews) if (alive(b) && b.recipeId) count[b.recipeId] = (count[b.recipeId] ?? 0) + 1;
  const list = recipes.filter(alive);
  if (!list.length) return null;
  return [...list].sort(
    (a, b) =>
      Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
      (count[b.id] ?? 0) - (count[a.id] ?? 0) ||
      String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')),
  )[0];
}

/**
 * 初期レシピを抽出の計画にする。土台のレシピが雛形（4:6・基本形）なら比率を変えて作り直し、
 * そうでなければ湯量に合わせて注湯を比例で直す。土台がなければ4:6の標準。
 * @param {object} init initialRecipe の結果
 * @param {object|null} recipe 土台のレシピ
 * @param {object} bean
 */
export function initialPlan(init, recipe, bean) {
  const base = recipe
    ? planFromRecipe(recipe)
    : (() => {
        const template = { kind: '46', ratio: DEFAULT_RATIO, taste: 'standard', strength: 'standard' };
        const made = make46({ doseG: init.doseG, ratio: DEFAULT_RATIO });
        return planFromRecipe({ id: null, name: '', doseG: init.doseG, waterG: made.waterG, pours: made.pours, targetTotalSec: made.targetTotalSec, template });
      })();
  let plan = base;
  const t = base.template;
  if (t && (t.kind === '46' || t.kind === 'basic')) {
    const template = { ...t, ratio: init.ratio };
    const made = applyTemplate(template, init.doseG, base.flowGps);
    if (made) plan = { ...base, doseG: init.doseG, waterG: made.waterG, pours: made.pours, targetTotalSec: made.targetTotalSec, template };
  }
  if (plan === base) plan = applyOverrides(base, { doseG: init.doseG, waterG: Math.round(init.doseG * init.ratio) });
  plan = {
    ...plan,
    tempC: init.tempC,
    grind: { grinderId: init.grind.grinderId ?? base.grind?.grinderId ?? null, setting: init.grind.setting },
    source: 'initial',
    beanId: bean?.id ?? null,
    name: `${bean?.name ?? '新しい豆'}の最初のレシピ`,
  };
  plan.ratio = ratioOf(plan.doseG, plan.waterG);
  return plan;
}

/** 「20g・1:15.5・93℃・挽き目 24（中細挽き）」 */
export function initialText(init) {
  const grind = init.grind.setting ? `挽き目 ${init.grind.setting}（${init.grind.word}）` : `挽き目 ${init.grind.word}`;
  return `${init.doseG}g・1:${init.ratio}・${init.tempC}℃・${grind}`;
}

export const INITIAL_SOURCES = Object.freeze({ similar: '似た豆から', own: '自分の初期値', table: '焙煎度の叩き台' });
