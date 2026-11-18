// ダイヤルイン診断（F1）：味の評価から「次の1杯で変える1つとその量」を根拠付きで出す（純粋関数）
// spec 6.2。1杯を「濃さ」（縦）と「抽出の進み具合」（横）の3×3のマスに置き、マスごとの直し方を出す。
// - 縦：ちょうど良さの「濃さ」。未回答なら一言の「薄い」「濃い」
// - 横：酸味が強い（+1以上）なら抽出が足りない、苦味か渋みが強いなら抽出しすぎ、両方強いなら判断しない
//   （項目ごとに、未回答なら一言の「酸っぱい」「苦い」「渋い」で代わりにする）
// - 直す順番：濃さのズレを先に、抽出のズレを後に。1杯で変えるのは1つだけ
// - 挽き目は「数字が小さいほど細かい」として計算する

import { pickTasting, jarWord } from './tastings.js';
import { planFromBrew, ratioOf, scalePoursToWater, fillPourSecs } from './recipes.js';
import { parseNumber } from './beans.js';

/** 縦（濃さ）の呼び方 */
export const STRENGTH_LABELS = Object.freeze({ weak: '薄い', ok: 'ちょうど', strong: '濃い' });
/** 横（抽出の進み具合）の呼び方 */
export const EXTRACTION_LABELS = Object.freeze({ under: '抽出が足りない', ok: 'ちょうど良い', over: '抽出しすぎ', mixed: '判断できない' });

/** 1回の変更幅（spec 6.2） */
export const RATIO_STEP = 0.5;
export const DEFAULT_GRIND_STEP = 1;

/**
 * 9マスの名前と直し方の順番（spec 6.2の表）。
 * steps の1つ目を今回の提案にし、2つ目は「濃さが直ったら次に」として添える。
 */
export const CELLS = Object.freeze({
  'strong/under': { name: '濃いのに酸っぱい', steps: ['water', 'finer'] },
  'strong/ok': { name: '重い・濃すぎる', steps: ['water'] },
  'strong/over': { name: '苦くて重い・渋い', steps: ['water', 'coarser'] },
  'ok/under': { name: '酸っぱい・余韻が短い', steps: ['finer'], alt: 'または湯温を2℃上げる' },
  'ok/ok': { name: '好みの1杯', steps: ['keep'] },
  'ok/over': { name: '渋い・ドライ・えぐい', steps: ['coarser'], alt: 'または攪拌を減らす' },
  'weak/under': { name: '薄くて酸っぱい', steps: ['dose', 'finer'] },
  'weak/ok': { name: '水っぽい', steps: ['dose'] },
  'weak/over': { name: '薄いのに渋い', steps: ['dose', 'coarser'] },
});

/** 直し方の短い呼び方 */
export const ACTION_LABELS = Object.freeze({
  water: '湯を増やす（比率を薄く）',
  dose: '粉を増やす（比率を濃く）',
  finer: '挽き目を1目盛り細かく',
  coarser: '挽き目を1目盛り粗く',
  keep: 'そのまま続ける',
  repeat: '同じ条件でもう1杯',
});

/** 提案に使う直し方（計画を変えるもの） */
export const CHANGING_KINDS = Object.freeze(['water', 'dose', 'finer', 'coarser']);

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => String(round2(n));

/** JARの値。未回答なら、一言タグがあれば +1（強すぎ側）として扱う */
function level(jar, key, tags, tag) {
  const v = jar?.[key];
  if (v != null) return { v, from: 'jar' };
  if (tags.includes(tag)) return { v: 1, from: 'tag' };
  return { v: null, from: null };
}

/**
 * 評価から、マスの縦と横を決める。
 * @param {{jar?:object, tags?:string[]}|null} tasting
 * @returns {{strength:'weak'|'ok'|'strong'|null, extraction:'under'|'ok'|'over'|'mixed'|null,
 *   strengthFrom:'jar'|'tag'|null, extractionFrom:'jar'|'tag'|null, symptoms:string[]}}
 */
export function diagnose(tasting) {
  const jar = tasting?.jar ?? {};
  const tags = Array.isArray(tasting?.tags) ? tasting.tags : [];
  const symptoms = [];

  // 縦：濃さ
  let strength = null;
  let strengthFrom = null;
  if (jar.strength != null) {
    strength = jar.strength <= -1 ? 'weak' : jar.strength >= 1 ? 'strong' : 'ok';
    strengthFrom = 'jar';
    symptoms.push(`濃さ ${jarWord('strength', jar.strength)}`);
  } else if (tags.includes('薄い') !== tags.includes('濃い')) {
    strength = tags.includes('薄い') ? 'weak' : 'strong';
    strengthFrom = 'tag';
    symptoms.push(`一言「${tags.includes('薄い') ? '薄い' : '濃い'}」`);
  }

  // 横：抽出の進み具合
  const sour = level(jar, 'acidity', tags, '酸っぱい');
  const bitter = level(jar, 'bitterness', tags, '苦い');
  const astr = level(jar, 'astringency', tags, '渋い');
  const items = [
    ['acidity', '酸味', sour, '酸っぱい'],
    ['bitterness', '苦味', bitter, '苦い'],
    ['astringency', '渋み', astr, '渋い'],
  ];
  for (const [key, label, lv, tag] of items) {
    if (lv.from === 'jar') symptoms.push(`${label} ${jarWord(key, lv.v)}`);
    else if (lv.from === 'tag') symptoms.push(`一言「${tag}」`);
  }
  const harshVals = [bitter.v, astr.v].filter((v) => v != null);
  const known = sour.v != null || harshVals.length > 0;
  let extraction = null;
  let extractionFrom = null;
  if (known) {
    const isSour = sour.v != null && sour.v >= 1;
    const isHarsh = harshVals.some((v) => v >= 1);
    extraction = isSour && isHarsh ? 'mixed' : isSour ? 'under' : isHarsh ? 'over' : 'ok';
    extractionFrom = [sour, bitter, astr].some((l) => l.from === 'jar') ? 'jar' : 'tag';
  }
  return { strength, extraction, strengthFrom, extractionFrom, symptoms };
}

/**
 * 次の抽出の土台にする計画：前回の抽出の計画を写し、挽き目だけは実際に挽いた目盛りにする
 * （実績の確認で挽き目を直したなら、その目盛りで淹れた味の評価だから）
 * @param {object} brew
 * @param {object|null} recipe
 */
export function basePlanForNext(brew, recipe = null) {
  const plan = planFromBrew(brew, recipe);
  const actualGrind = String(brew.actual?.grind?.setting ?? '').trim();
  if (actualGrind) plan.grind = { ...plan.grind, setting: actualGrind };
  return plan;
}

/**
 * 直し方1つを、計画の数字に当てはめた中身にする。
 * @param {string} kind ACTION_LABELS のキー
 * @param {object} plan basePlanForNext の計画
 * @param {number} [grindStep] グラインダーの1目盛り
 * @returns {{kind:string, variable:string|null, from:any, to:any, unit:string, text:string, short:string}}
 */
export function makeAction(kind, plan, grindStep = DEFAULT_GRIND_STEP) {
  const dose = plan?.doseG;
  const water = plan?.waterG;
  const ratio = ratioOf(dose, water);
  const base = { kind, variable: null, from: null, to: null, unit: '', text: ACTION_LABELS[kind], short: ACTION_LABELS[kind] };

  if (kind === 'water' || kind === 'dose') {
    if (!(dose > 0) || !(water > 0)) return { ...base, text: `${ACTION_LABELS[kind]}：比率を${RATIO_STEP}${kind === 'water' ? '薄く' : '濃く'}します` };
    if (kind === 'water') {
      const to = Math.round(water + dose * RATIO_STEP);
      return {
        ...base,
        variable: 'waterG',
        from: water,
        to,
        unit: 'g',
        short: `湯量 ${water}g → ${to}g`,
        text: `湯を増やす：湯量 ${water}g → ${to}g（比率 1:${ratio} → 1:${ratioOf(dose, to)}）。粉量はそのまま`,
      };
    }
    const to = round1(water / (water / dose - RATIO_STEP));
    return {
      ...base,
      variable: 'doseG',
      from: dose,
      to,
      unit: 'g',
      short: `粉量 ${dose}g → ${to}g`,
      text: `粉を増やす：粉量 ${dose}g → ${to}g（比率 1:${ratio} → 1:${ratioOf(to, water)}）。湯量はそのまま`,
    };
  }

  if (kind === 'finer' || kind === 'coarser') {
    const step = grindStep > 0 ? grindStep : DEFAULT_GRIND_STEP;
    const cur = String(plan?.grind?.setting ?? '').trim();
    const n = parseNumber(cur);
    if (n == null || Number.isNaN(n)) {
      return {
        ...base,
        variable: 'grind',
        from: cur || null,
        text: `${ACTION_LABELS[kind]}（挽き目の目盛りが数字で記録されていないので、目盛りは手で合わせてください）`,
      };
    }
    const to = fmt(kind === 'finer' ? n - step : n + step);
    return {
      ...base,
      variable: 'grind',
      from: cur,
      to,
      short: `挽き目 ${cur} → ${to}`,
      text: `${ACTION_LABELS[kind]}：挽き目 ${cur} → ${to}`,
    };
  }

  if (kind === 'keep') return { ...base, text: 'そのまま続ける（甘さと酸味の加減は注湯の配分で）' };
  return { ...base, text: '同じ条件でもう1杯淹れて確かめる（酸味と苦味・渋みが両方強く、どちらに直すか決められないため）' };
}

/** 直し方ごとに、次の杯で動いてほしいJARの項目（今の値を0に近づけたい） */
function targetValue(kind, jar) {
  if (!jar) return null;
  if (kind === 'water' || kind === 'dose') return jar.strength ?? null;
  if (kind === 'finer') return jar.acidity ?? null;
  if (kind === 'coarser') {
    const vals = [jar.bitterness, jar.astringency].filter((v) => v != null);
    return vals.length ? Math.max(...vals) : null;
  }
  return null;
}

const TARGET_WORDS = Object.freeze({
  water: ['湯を増やした', '濃すぎが和らいだ'],
  dose: ['粉を増やした', '薄すぎが和らいだ'],
  finer: ['挽き目を細かくした', '酸味が下がった'],
  coarser: ['挽き目を粗くした', '苦味・渋みが下がった'],
});

/**
 * あなたの実績：提案どおりに淹れた次の杯で、狙った項目がちょうどに近づいた回数。
 * 前と後の両方にJARの値がある回だけ数える。この豆の実績がなければ、ほかの豆も含めて数える。
 * @param {string} kind
 * @param {string|null} beanId
 * @param {object[]} suggestions 提案ログ
 * @param {object[]} tastings 評価の全部
 * @returns {{scope:'bean'|'all'|null, total:number, improved:number, text:string}}
 */
export function actionHistory(kind, beanId, suggestions = [], tastings = []) {
  if (!TARGET_WORDS[kind]) return { scope: null, total: 0, improved: 0, text: '' };
  const pairs = (suggestions ?? [])
    .filter((s) => s && s.deletedAt == null && s.adopted === true && s.nextBrewId && s.action?.kind === kind)
    .map((s) => {
      const before = targetValue(kind, s.jarBefore);
      const after = targetValue(kind, pickTasting(tastings, s.nextBrewId)?.jar);
      return before == null || after == null ? null : { beanId: s.beanId ?? null, improved: Math.abs(after) < Math.abs(before) };
    })
    .filter(Boolean);
  const own = beanId ? pairs.filter((p) => p.beanId === beanId) : [];
  const [scope, list] = own.length ? ['bean', own] : pairs.length ? ['all', pairs] : [null, []];
  const improved = list.filter((p) => p.improved).length;
  const [did, got] = TARGET_WORDS[kind];
  const text = scope
    ? `${scope === 'bean' ? 'この豆で' : 'ほかの豆も含めて、'}${did}${list.length}回中${improved}回で、次の杯の${got}`
    : 'まだ実績がありません（提案どおりに淹れて評価すると、ここに貯まります）';
  return { scope, total: list.length, improved, text };
}

/** 確信度の呼び方 */
export const CONFIDENCE_LABELS = Object.freeze({ high: '高い', mid: 'ふつう', low: '低い' });

/**
 * 確信度：入力の確かさ（ちょうど良さで縦横とも答えた＝2、一言だけ・片方を答えていない＝1）に、
 * 実績（2回以上あって3分の2以上で良くなった＝+1、半分未満＝−1）を足す。3以上＝高い、2＝ふつう、1以下＝低い
 */
export function confidenceOf(diag, history, kind) {
  const reasons = [];
  let score;
  if (kind === 'repeat') {
    return { level: 'low', text: '酸味と苦味・渋みが両方強く、どちらのズレか決められないため' };
  }
  if (diag.strengthFrom === 'jar' && diag.extractionFrom === 'jar') {
    score = 2;
    reasons.push('ちょうど良さで濃さと抽出の両方に答えている');
  } else {
    score = 1;
    if (diag.strength == null) reasons.push('濃さは答えていないので、ちょうどとして扱った');
    else if (diag.strengthFrom === 'tag') reasons.push('濃さは一言のタグから判断した');
    if (diag.extraction == null) reasons.push('酸味・苦味・渋みは答えていないので、ちょうどとして扱った');
    else if (diag.extractionFrom === 'tag') reasons.push('抽出は一言のタグから判断した');
  }
  if (history.total >= 2) {
    const rate = history.improved / history.total;
    if (rate >= 2 / 3) {
      score += 1;
      reasons.push('同じ直し方で良くなった実績が多い');
    } else if (rate < 1 / 2) {
      score -= 1;
      reasons.push('同じ直し方で良くならなかった実績が多い');
    }
  } else reasons.push('実績はまだ少ない');
  const level = score >= 3 ? 'high' : score === 2 ? 'mid' : 'low';
  return { level, text: reasons.join('。') };
}

/**
 * 次の1杯の提案を作る。判断する材料がなければ null。
 * @param {{tasting:object, plan:object, grindStep?:number, beanId?:string|null, suggestions?:object[], tastings?:object[]}} p
 *   plan は basePlanForNext の計画。suggestions と tastings は実績を数えるための全部の記録
 * @returns {null | {cell:{strength:string, extraction:string}, cellName:string, action:object, nextStep:string|null, alt:string|null,
 *   reasons:{input:string[], theory:string, history:string, confidence:{level:string, text:string}}}}
 */
export function suggestNext({ tasting, plan, grindStep = DEFAULT_GRIND_STEP, beanId = null, suggestions = [], tastings = [] }) {
  const diag = diagnose(tasting);
  if (diag.strength == null && diag.extraction == null) return null;
  const strength = diag.strength ?? 'ok';
  const extraction = diag.extraction ?? 'ok';

  let cellName;
  let steps;
  let alt = null;
  let theory;
  if (extraction === 'mixed') {
    // 酸味と苦味・渋みが両方強い：抽出のズレの向きは決めない。濃さがずれていれば濃さだけ直す
    cellName = strength === 'ok' ? '酸っぱくて苦い（判断できない）' : `${STRENGTH_LABELS[strength]}（抽出は判断できない）`;
    steps = strength === 'strong' ? ['water'] : strength === 'weak' ? ['dose'] : ['repeat'];
    theory =
      strength === 'ok'
        ? '酸味（抽出が足りない印）と苦味・渋み（抽出しすぎの印）が両方強く、マスを1つに決められません。同じ条件で淹れ直して確かめます'
        : `濃さ「${STRENGTH_LABELS[strength]}」。抽出は酸味と苦味・渋みが両方強く判断できないので、先に濃さだけ直します`;
  } else {
    const cell = CELLS[`${strength}/${extraction}`];
    cellName = cell.name;
    steps = cell.steps;
    alt = cell.alt ?? null;
    theory = `濃さ「${STRENGTH_LABELS[strength]}」×抽出「${EXTRACTION_LABELS[extraction]}」のマス（${cell.name}）`;
    if (steps.length > 1) theory += '。角のマスなので、濃さのズレを先に直し、抽出はその次の杯で直します';
    else if (steps[0] === 'keep') theory += '。真ん中の目標のマスです';
    theory += '。1杯で変えるのは1つだけ';
  }

  const kind = steps[0];
  const action = makeAction(kind, plan, grindStep);
  const nextStep = steps[1] ? `濃さが直ったら、次は${ACTION_LABELS[steps[1]]}` : null;
  const history = actionHistory(kind, beanId, suggestions, tastings);
  const confidence = confidenceOf(diag, history, kind);

  return {
    cell: { strength, extraction },
    cellName,
    action,
    nextStep,
    alt,
    reasons: {
      input: diag.symptoms,
      theory,
      history: TARGET_WORDS[kind] ? history.text : '',
      confidence,
    },
  };
}

/**
 * 提案ログに保存する中身（id・日時の共通項目は db 側で付ける）
 * @param {{brew:object, tasting:object, suggestion:object}} p suggestion は suggestNext の結果
 */
export function buildSuggestion({ brew, tasting, suggestion }) {
  return {
    kind: 'dialin',
    brewId: brew.id,
    tastingId: tasting.id ?? null,
    beanId: brew.beanId ?? null,
    recipeId: brew.recipeId ?? null,
    cell: { ...suggestion.cell },
    cellName: suggestion.cellName,
    action: { ...suggestion.action },
    nextStep: suggestion.nextStep,
    alt: suggestion.alt,
    reasons: JSON.parse(JSON.stringify(suggestion.reasons)),
    confidence: suggestion.reasons.confidence.level,
    jarBefore: { ...(tasting.jar ?? {}) },
    tagsBefore: [...(tasting.tags ?? [])],
    adopted: null, // 次の抽出を保存したときに true（この提案で淹れた）か false
    nextBrewId: null,
  };
}

/**
 * 提案を計画に当てはめる（レシピは変えず、次の1杯の計画だけを変える）。
 * @param {object} plan basePlanForNext の計画
 * @param {object} action makeAction の中身
 * @returns {object} 新しい計画
 */
export function applyAction(plan, action) {
  const next = { ...plan, grind: { ...(plan.grind ?? {}) }, pours: (plan.pours ?? []).map((p) => ({ ...p })) };
  if (action?.to == null) return next;
  if (action.variable === 'waterG') {
    next.waterG = action.to;
    next.pours = fillPourSecs(scalePoursToWater(next.pours, action.to), next.flowGps);
  } else if (action.variable === 'doseG') {
    next.doseG = action.to;
  } else if (action.variable === 'grind') {
    next.grind.setting = String(action.to);
  }
  next.ratio = ratioOf(next.doseG, next.waterG);
  return next;
}

const alive = (r) => r && r.deletedAt == null;

/** その抽出の提案（削除済みは除く）。なければ null */
export function pickSuggestionForBrew(suggestions, brewId) {
  const list = (suggestions ?? []).filter((s) => alive(s) && s.brewId === brewId);
  return list.length ? list.reduce((a, b) => (String(a.updatedAt) >= String(b.updatedAt) ? a : b)) : null;
}

/** その豆で、まだ次の抽出に使われていない、計画を変える提案のうち最新のもの。なければ null */
export function pickPendingSuggestion(suggestions, beanId) {
  if (!beanId) return null;
  const list = (suggestions ?? []).filter(
    (s) => alive(s) && s.beanId === beanId && s.nextBrewId == null && CHANGING_KINDS.includes(s.action?.kind) && s.action?.to != null,
  );
  return list.length ? list.reduce((a, b) => (String(a.createdAt) >= String(b.createdAt) ? a : b)) : null;
}

/**
 * 抽出を保存したときに、提案ログに「採用したか」と「次の抽出」を書き込む中身。
 * まだ次の抽出がない提案のうち、この抽出で使った提案と、同じ豆の提案が対象。
 * @param {object[]} suggestions
 * @param {{id:string, beanId?:string|null, suggestionId?:string|null}} brew 保存した抽出
 * @returns {{id:string, adopted:boolean, nextBrewId:string}[]}
 */
export function linkSuggestions(suggestions, brew) {
  return (suggestions ?? [])
    .filter(
      (s) =>
        alive(s) &&
        s.nextBrewId == null &&
        s.brewId !== brew.id &&
        (s.id === brew.suggestionId || (brew.beanId != null && s.beanId === brew.beanId)),
    )
    .map((s) => ({ id: s.id, adopted: s.id === brew.suggestionId, nextBrewId: brew.id }));
}
