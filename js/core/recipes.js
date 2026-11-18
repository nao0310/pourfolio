// レシピ（淹れ方の型）の計算と入力チェック（純粋関数）
// - 注湯ステップは「何秒の時点で、累計何gまで注ぐか」の並び。1投目が蒸らし
// - 雛形：4:6メソッド（前半40%・後半60%）と、蒸らし＋2〜3回注湯の基本形（spec 13.2）

import { parseNumber } from './beans.js';

/** 注ぎ方（spec 13.2） */
export const POUR_STYLES = Object.freeze({ center: '中心', circle: '円', noji: 'の字', swirl: 'スワール', stir: '攪拌' });

/** 4:6メソッドの「味」：前半40%の2投の配分を変える */
export const TASTES_46 = Object.freeze({ sweet: '甘め', standard: '標準', bright: '明るめ' });
/** 4:6メソッドの「濃さ」：後半60%を何投に分けるか */
export const STRENGTHS_46 = Object.freeze({ light: '軽め', standard: '標準', strong: '濃いめ' });
const FIRST_POUR_SHARE = { sweet: 5 / 12, standard: 1 / 2, bright: 7 / 12 };
const LATER_POUR_COUNT = { light: 2, standard: 3, strong: 4 };

/** 雛形の種類 */
export const TEMPLATE_KINDS = Object.freeze({ '46': '4:6メソッド', basic: '基本形（蒸らし＋2〜3回）' });

export const DEFAULT_RATIO = 15;
export const DEFAULT_TEMP_C = 92;
/** 目安の流速（g/秒）の初期値。注ぐ秒数の自動計算に使う */
export const DEFAULT_FLOW_GPS = 10;

const round1 = (n) => Math.round(n * 10) / 10;
const clean = (v) => String(v ?? '').normalize('NFKC').trim();

/** 比率（湯量÷粉量）。小数1桁 */
export function ratioOf(doseG, waterG) {
  if (!(doseG > 0) || !(waterG > 0)) return null;
  return round1(waterG / doseG);
}

/** 粉量と比率から湯量（g、整数） */
export function waterFromRatio(doseG, ratio) {
  if (!(doseG > 0) || !(ratio > 0)) return null;
  return Math.round(doseG * ratio);
}

/**
 * 秒の入力を読む。「1:30」「90」「1分30秒」を受け付ける。空なら null、読めなければ NaN
 */
export function parseSec(v) {
  const s = clean(v);
  if (s === '') return null;
  let m = /^(\d+):(\d{1,2})$/.exec(s);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(?:(\d+)分)?(?:(\d+)秒)?$/.exec(s);
  if (m && (m[1] || m[2])) return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  const n = Number(s.replace(/秒$/, ''));
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

/** 流速（g/秒）。小数1桁。計算できなければ null */
export function flowOf(addG, pourSec) {
  if (!(addG > 0) || !(pourSec > 0)) return null;
  return round1(addG / pourSec);
}

/** 注ぐ量と流速から、注ぐ秒数（整数・1秒以上） */
export function pourSecFromFlow(addG, flowGps = DEFAULT_FLOW_GPS) {
  if (!(addG > 0)) return null;
  const f = flowGps > 0 ? flowGps : DEFAULT_FLOW_GPS;
  return Math.max(1, Math.round(addG / f));
}

/**
 * i投目の注ぐ秒数。保存された値があればそれ、なければ（古いレシピ・抽出）注ぐ量÷流速で計算する。
 * 次の注湯の時刻を越える分は切り詰める（自動の値だけ。手で入れた値は入力チェックで止める）
 * @param {{atSec:number,toG:number,pourSec?:number}[]} pours
 * @param {number} i
 * @param {number} [flowGps]
 */
export function pourSecOf(pours, i, flowGps = DEFAULT_FLOW_GPS) {
  const p = pours[i];
  if (!p) return null;
  if (typeof p.pourSec === 'number' && p.pourSec > 0) return p.pourSec;
  const prevG = i > 0 ? pours[i - 1].toG : 0;
  const sec = pourSecFromFlow(p.toG - prevG, flowGps);
  if (sec == null) return null;
  const next = pours[i + 1];
  return next && typeof next.atSec === 'number' && typeof p.atSec === 'number' ? Math.max(1, Math.min(sec, next.atSec - p.atSec)) : sec;
}

/**
 * 手で直していない投（pourSecManual でない）の注ぐ秒数を、注ぐ量÷流速で入れ直す
 * @param {object[]} pours 累計 toG が数の並び（数でない行はそのまま）
 * @param {number} [flowGps]
 */
export function fillPourSecs(pours, flowGps = DEFAULT_FLOW_GPS) {
  const base = pours.map((p) => {
    if (p.pourSecManual) return { ...p };
    const { pourSec, ...rest } = p;
    return rest;
  });
  return base.map((p, i) => {
    if (p.pourSecManual) return p;
    const ok = typeof p.toG === 'number' && (i === 0 || typeof base[i - 1].toG === 'number');
    const sec = ok ? pourSecOf(base, i, flowGps) : null;
    return sec == null ? p : { ...p, pourSec: sec };
  });
}

/** 累計の湯量を、最後がちょうど waterG になるように丸める */
function cumulative(amounts, waterG) {
  const out = [];
  let sum = 0;
  amounts.forEach((a, i) => {
    sum += a;
    out.push(i === amounts.length - 1 ? waterG : Math.round(sum));
  });
  return out;
}

/**
 * 4:6メソッドの注湯を計算する。
 * 前半40%を2投（味で配分を変える）、後半60%を2〜4投（濃さで投数を変える）に分け、45秒ごとに注ぐ。
 * @param {{doseG:number, ratio?:number, taste?:string, strength?:string, intervalSec?:number, flowGps?:number}} p
 */
export function make46({ doseG, ratio = DEFAULT_RATIO, taste = 'standard', strength = 'standard', intervalSec = 45, flowGps = DEFAULT_FLOW_GPS }) {
  const waterG = waterFromRatio(doseG, ratio);
  if (waterG == null) return null;
  const first = Math.round(waterG * 0.4);
  const p1 = Math.round(first * (FIRST_POUR_SHARE[taste] ?? FIRST_POUR_SHARE.standard));
  const n = LATER_POUR_COUNT[strength] ?? LATER_POUR_COUNT.standard;
  const later = Array.from({ length: n }, () => (waterG - first) / n);
  const toGs = [p1, first, ...cumulative(later, waterG - first).map((g) => first + g)];
  const pours = fillPourSecs(toGs.map((toG, i) => ({ atSec: i * intervalSec, toG, style: 'circle' })), flowGps);
  return {
    waterG,
    pours,
    targetTotalSec: (pours.length - 1) * intervalSec + 30,
  };
}

/**
 * 基本形：粉量の2倍で蒸らし、残りを2〜3回に等分して注ぐ。
 * @param {{doseG:number, ratio?:number, pourCount?:number, bloomSec?:number, intervalSec?:number, flowGps?:number}} p
 */
export function makeBasic({ doseG, ratio = DEFAULT_RATIO, pourCount = 3, bloomSec = 40, intervalSec = 35, flowGps = DEFAULT_FLOW_GPS }) {
  const waterG = waterFromRatio(doseG, ratio);
  if (waterG == null) return null;
  const n = pourCount === 2 ? 2 : 3;
  const bloomG = Math.min(Math.round(doseG * 2), waterG);
  const rest = Array.from({ length: n }, () => (waterG - bloomG) / n);
  const toGs = [bloomG, ...cumulative(rest, waterG - bloomG).map((g) => bloomG + g)];
  const pours = fillPourSecs(
    toGs.map((toG, i) => ({ atSec: i === 0 ? 0 : bloomSec + (i - 1) * intervalSec, toG, style: i === 0 ? 'center' : 'noji' })),
    flowGps,
  );
  return {
    waterG,
    pours,
    targetTotalSec: pours[pours.length - 1].atSec + 70,
  };
}

/**
 * 雛形の設定と粉量から、湯量・注湯・目標時間を作る。
 * @param {{kind:'46'|'basic', ratio?:number, taste?:string, strength?:string, pourCount?:number}} template
 * @param {number} doseG
 * @param {number} [flowGps] 目安の流速（注ぐ秒数の計算に使う）
 */
export function applyTemplate(template, doseG, flowGps = DEFAULT_FLOW_GPS) {
  if (!template) return null;
  if (template.kind === '46') return make46({ doseG, ...template, flowGps });
  if (template.kind === 'basic') return makeBasic({ doseG, ...template, flowGps });
  return null;
}

/** 注湯の累計を、最後が waterG になるように比例で直す（湯量を変えたとき用） */
export function scalePoursToWater(pours, waterG) {
  if (!pours.length) return [];
  const last = pours[pours.length - 1].toG;
  if (!(last > 0)) return pours.map((p) => ({ ...p }));
  const k = waterG / last;
  return pours.map((p, i) => ({ ...p, toG: i === pours.length - 1 ? waterG : Math.round(p.toG * k) }));
}

/** 何も入っていない新しいレシピの入力（雛形は4:6の標準） */
export function newRecipeState(defaults = {}) {
  const doseG = defaults.doseG ?? 20;
  const template = { kind: '46', ratio: DEFAULT_RATIO, taste: 'standard', strength: 'standard' };
  const made = applyTemplate(template, doseG);
  return {
    name: '',
    doseG,
    waterG: made.waterG,
    tempC: DEFAULT_TEMP_C,
    grinderId: defaults.grinderId ?? '',
    grindSetting: '',
    dripperId: defaults.dripperId ?? '',
    filterId: defaults.filterId ?? '',
    kettleId: defaults.kettleId ?? '',
    pours: made.pours,
    bloomStir: false,
    targetTotalSec: made.targetTotalSec,
    flowGps: DEFAULT_FLOW_GPS,
    template,
    favorite: false,
    memo: '',
  };
}

/** 保存されているレシピを、編集画面の入力の形に戻す */
export function recipeToState(recipe) {
  return {
    name: recipe.name ?? '',
    doseG: recipe.doseG ?? null,
    waterG: recipe.waterG ?? null,
    tempC: recipe.tempC ?? null,
    grinderId: recipe.grind?.grinderId ?? '',
    grindSetting: recipe.grind?.setting ?? '',
    dripperId: recipe.equipment?.dripperId ?? '',
    filterId: recipe.equipment?.filterId ?? '',
    kettleId: recipe.equipment?.kettleId ?? '',
    pours: (recipe.pours ?? []).map((p, i, all) => ({
      atSec: p.atSec,
      toG: p.toG,
      style: p.style ?? '',
      pourSec: pourSecOf(all, i, recipe.flowGps ?? DEFAULT_FLOW_GPS),
      pourSecManual: Boolean(p.pourSecManual),
    })),
    bloomStir: Boolean(recipe.bloom?.stir),
    targetTotalSec: recipe.targetTotalSec ?? null,
    flowGps: recipe.flowGps ?? DEFAULT_FLOW_GPS,
    template: recipe.template ? { ...recipe.template } : null,
    favorite: Boolean(recipe.favorite),
    memo: recipe.memo ?? '',
  };
}

/**
 * レシピの入力を確かめて、保存する形にする。数字は文字列でも数でもよい。
 * @param {object} input recipeToState / newRecipeState と同じ形
 * @returns {{value: object, errors: Record<string, string>}}
 */
export function normalizeRecipeInput(input) {
  const errors = {};
  const num = (v) => (typeof v === 'number' ? v : parseNumber(v));

  const name = clean(input.name);
  if (!name) errors.name = 'レシピの名前を入れてください';

  let doseG = num(input.doseG);
  if (doseG == null || Number.isNaN(doseG) || doseG <= 0 || doseG > 100) {
    errors.doseG = '粉量は0より大きく100以下の数字（g）で入れてください';
    doseG = null;
  } else doseG = round1(doseG);

  let waterG = num(input.waterG);
  if (waterG == null || Number.isNaN(waterG) || waterG < 10 || waterG > 3000) {
    errors.waterG = '湯量は10〜3000の数字（g）で入れてください';
    waterG = null;
  } else waterG = round1(waterG);

  let tempC = num(input.tempC);
  if (tempC != null && (Number.isNaN(tempC) || tempC < 50 || tempC > 100)) {
    errors.tempC = '湯温は50〜100の数字（℃）で入れてください';
    tempC = null;
  } else if (tempC != null) tempC = round1(tempC);

  const pours = [];
  const rawPours = Array.isArray(input.pours) ? input.pours : [];
  if (!rawPours.length) errors.pours = '注湯を1つ以上入れてください';
  rawPours.forEach((p, i) => {
    const atSec = typeof p.atSec === 'number' ? p.atSec : parseSec(p.atSec);
    const toG = num(p.toG);
    if (atSec == null || Number.isNaN(atSec) || atSec < 0 || atSec > 3600) {
      errors.pours ??= `${i + 1}投目の時間を「0:45」のように入れてください`;
    }
    if (toG == null || Number.isNaN(toG) || toG <= 0) errors.pours ??= `${i + 1}投目の累計湯量を入れてください`;
    const style = Object.hasOwn(POUR_STYLES, p.style) ? p.style : '';
    let pourSec = typeof p.pourSec === 'number' ? p.pourSec : parseSec(p.pourSec);
    if (pourSec != null && (Number.isNaN(pourSec) || pourSec <= 0 || pourSec > 600)) {
      errors.pours ??= `${i + 1}投目の注ぐ秒数は1〜600の数字で入れてください`;
      pourSec = null;
    }
    const pour = { atSec, toG: toG == null || Number.isNaN(toG) ? toG : round1(toG), style };
    if (pourSec != null) pour.pourSec = Math.round(pourSec);
    if (p.pourSecManual && pourSec != null) pour.pourSecManual = true;
    pours.push(pour);
  });
  if (!errors.pours) {
    for (let i = 1; i < pours.length; i++) {
      if (pours[i].atSec <= pours[i - 1].atSec) {
        errors.pours = `${i + 1}投目の時間は、${i}投目より後にしてください`;
        break;
      }
      if (pours[i].toG <= pours[i - 1].toG) {
        errors.pours = `${i + 1}投目の累計湯量は、${i}投目より多くしてください`;
        break;
      }
    }
  }
  if (!errors.pours) {
    for (let i = 0; i < pours.length - 1; i++) {
      if (pours[i].pourSec != null && pours[i].atSec + pours[i].pourSec > pours[i + 1].atSec) {
        errors.pours = `${i + 1}投目は次の注湯までに注ぎ終わりません。注ぐ秒数を${pours[i + 1].atSec - pours[i].atSec}秒以下にしてください`;
        break;
      }
    }
  }
  if (!errors.pours && waterG != null && Math.abs(pours[pours.length - 1].toG - waterG) > 0.5) {
    errors.pours = `最後の注湯の累計（${pours[pours.length - 1].toG}g）を湯量（${waterG}g）に合わせてください`;
  }

  let targetTotalSec = typeof input.targetTotalSec === 'number' ? input.targetTotalSec : parseSec(input.targetTotalSec);
  if (targetTotalSec != null && (Number.isNaN(targetTotalSec) || targetTotalSec <= 0 || targetTotalSec > 3600)) {
    errors.targetTotalSec = '目標時間を「3:30」のように入れてください';
    targetTotalSec = null;
  }

  let flowGps = num(input.flowGps);
  if (flowGps == null || Number.isNaN(flowGps) || flowGps <= 0 || flowGps > 100) flowGps = DEFAULT_FLOW_GPS;
  else flowGps = round1(flowGps);

  // 注ぐ秒数が空の投は、注ぐ量÷流速で入れる
  if (!errors.pours) {
    pours.forEach((p, i) => {
      if (p.pourSec == null) p.pourSec = pourSecOf(pours, i, flowGps);
    });
  }

  const id = (v) => clean(v) || null;
  const template = normalizeTemplate(input.template);

  return {
    value: {
      name,
      doseG,
      waterG,
      tempC,
      grind: { grinderId: id(input.grinderId), setting: clean(input.grindSetting) },
      equipment: { dripperId: id(input.dripperId), filterId: id(input.filterId), kettleId: id(input.kettleId) },
      bloom: {
        waterG: pours[0]?.toG ?? null,
        sec: pours[1]?.atSec ?? null,
        stir: Boolean(input.bloomStir),
      },
      pours,
      targetTotalSec,
      flowGps,
      template,
      favorite: Boolean(input.favorite),
      memo: clean(input.memo),
    },
    errors,
  };
}

function normalizeTemplate(t) {
  if (!t || !Object.hasOwn(TEMPLATE_KINDS, t.kind)) return null;
  const ratio = typeof t.ratio === 'number' && t.ratio > 0 ? round1(t.ratio) : DEFAULT_RATIO;
  if (t.kind === '46') {
    return {
      kind: '46',
      ratio,
      taste: Object.hasOwn(TASTES_46, t.taste) ? t.taste : 'standard',
      strength: Object.hasOwn(STRENGTHS_46, t.strength) ? t.strength : 'standard',
    };
  }
  return { kind: 'basic', ratio, pourCount: t.pourCount === 2 ? 2 : 3 };
}

/** 秒を「3:30」の形にする */
export function formatSec(sec) {
  if (sec == null || Number.isNaN(sec)) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** レシピの要点を1行にする「20g・300g（1:15）・92℃・挽き目 24」 */
export function recipeSummary(r) {
  const ratio = ratioOf(r.doseG, r.waterG);
  const g = (n) => `${round1(n)}g`;
  return [
    r.doseG != null ? g(r.doseG) : '',
    r.waterG != null ? `${g(r.waterG)}${ratio ? `（1:${ratio}）` : ''}` : '',
    r.tempC != null ? `${r.tempC}℃` : '',
    r.grind?.setting ? `挽き目 ${r.grind.setting}` : '',
  ]
    .filter(Boolean)
    .join('・');
}

/** 雛形の説明「4:6メソッド・甘め・濃いめ」（標準は書かない） */
export function templateLabel(t) {
  if (!t) return '';
  if (t.kind === '46') {
    const opt = (dict, v) => (v && v !== 'standard' ? dict[v] : '');
    return ['4:6メソッド', opt(TASTES_46, t.taste), opt(STRENGTHS_46, t.strength)].filter(Boolean).join('・');
  }
  if (t.kind === 'basic') return `基本形・${t.pourCount === 2 ? 2 : 3}回注湯`;
  return '';
}

const alive = (r) => r && r.deletedAt == null;

/** いちばん新しい抽出（削除の印が付いたものは除く） */
export function latestBrew(brews) {
  let best = null;
  for (const b of brews) {
    if (!alive(b)) continue;
    if (!best || String(b.at) > String(best.at)) best = b;
  }
  return best;
}

/**
 * 一覧に出す順：お気に入り → 最後に使った日時の新しい順 → 更新の新しい順
 * @param {object[]} recipes
 * @param {object[]} [brews] 抽出の記録（使った日時を見るため）
 */
export function orderRecipesForList(recipes, brews = []) {
  const lastUsed = {};
  for (const b of brews) {
    if (!alive(b) || !b.recipeId) continue;
    if (!lastUsed[b.recipeId] || String(b.at) > lastUsed[b.recipeId]) lastUsed[b.recipeId] = String(b.at);
  }
  return recipes
    .filter(alive)
    .map((r) => ({ ...r, lastUsedAt: lastUsed[r.id] ?? null }))
    .sort(
      (a, b) =>
        Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
        String(b.lastUsedAt ?? '').localeCompare(String(a.lastUsedAt ?? '')) ||
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
}

/**
 * 抽出に渡す「計画」をレシピから写す（後でレシピを直しても、抽出の記録は変わらないように）
 */
export function planFromRecipe(recipe) {
  return {
    source: 'recipe',
    recipeId: recipe.id ?? null,
    recipeVersion: recipe.version ?? 1,
    name: recipe.name ?? '',
    doseG: recipe.doseG ?? null,
    waterG: recipe.waterG ?? null,
    ratio: ratioOf(recipe.doseG, recipe.waterG),
    tempC: recipe.tempC ?? null,
    grind: { grinderId: recipe.grind?.grinderId ?? null, setting: recipe.grind?.setting ?? '' },
    equipment: { ...(recipe.equipment ?? {}) },
    bloom: { ...(recipe.bloom ?? {}) },
    pours: withPourSecs(recipe.pours ?? [], recipe.flowGps),
    targetTotalSec: recipe.targetTotalSec ?? null,
    flowGps: recipe.flowGps ?? DEFAULT_FLOW_GPS,
    template: recipe.template ? { ...recipe.template } : null,
  };
}

/** 注湯の写し。注ぐ秒数のない投（古いデータ）には計算した秒数を入れる */
function withPourSecs(pours, flowGps = DEFAULT_FLOW_GPS) {
  return pours.map((p, i) => ({ ...p, pourSec: pourSecOf(pours, i, flowGps ?? DEFAULT_FLOW_GPS) }));
}

/**
 * 前回の抽出から計画を写す（A1）。実績ではなく、その時の計画を使う。
 * 元のレシピが残っていればその注湯ステップなどを土台にし、抽出に残った計画の値で上書きする。
 * @param {object} brew 抽出の記録
 * @param {object|null} [recipe] brew.recipeId のレシピ（削除済みなら null）
 */
export function planFromBrew(brew, recipe = null) {
  const base = alive(recipe) ? planFromRecipe(recipe) : planFromRecipe({ id: brew.recipeId ?? null, name: '' });
  const p = brew.planned ?? {};
  const grind = typeof p.grind === 'string' ? { grinderId: base.grind.grinderId, setting: p.grind } : p.grind;
  const plan = {
    ...base,
    ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)),
    grind: grind ? { ...base.grind, ...grind } : base.grind,
    equipment: { ...base.equipment, ...(brew.equipment ?? {}), ...(p.equipment ?? {}) },
    pours: withPourSecs(p.pours ?? base.pours, p.flowGps ?? base.flowGps),
    source: 'lastBrew',
    fromBrewId: brew.id,
    beanId: brew.beanId ?? null,
  };
  plan.ratio = ratioOf(plan.doseG, plan.waterG);
  if (!plan.name) plan.name = '前回と同じ';
  return plan;
}
