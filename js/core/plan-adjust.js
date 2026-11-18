// 抽出の計画の調整（純粋関数）：気分プリセット（F4）、杯数・アイス換算（A6）、数値の上書き（F5の取り込みなど）
// 調整は「気分 → 数値の上書き → 杯数 → アイス」の順に当てはめ、何をしたかを plan.adjust に残す。
// plan.adjust は抽出の記録の planned に写り、context（気分・杯数・氷）の元になる。

import { ratioOf, waterFromRatio, applyTemplate, scalePoursToWater, fillPourSecs, DEFAULT_FLOW_GPS, TASTES_46, STRENGTHS_46 } from './recipes.js';
import { parseNumber } from './beans.js';

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * 気分プリセット（spec 6.4）。狙いの味を「比率」と「4:6の味・濃さ」に置き換える。
 * roastGroups は今日の1杯（F3）で少し点数を足す焙煎度の区分。
 */
export const MOODS = Object.freeze({
  wake: { label: '目覚め', aim: '明るい酸味・やや濃いめ', ratioDelta: -0.5, taste: 'bright', strength: 'strong', roastGroups: ['light', 'medium'] },
  relax: { label: 'くつろぎ', aim: '甘さ重視・やや薄め', ratioDelta: 0.5, taste: 'sweet', strength: null, roastGroups: ['medium', 'mediumDark'] },
  meal: { label: '食後', aim: 'ボディ重視', ratioDelta: -0.5, taste: null, strength: 'strong', roastGroups: ['mediumDark', 'dark'] },
  guest: { label: '来客', aim: '失敗しにくい定番を杯数ぶん', ratioDelta: 0, taste: null, strength: null, roastGroups: [], cups: 2 },
});

/** 量の選択肢（1杯＝レシピの量）。0.7は「少なめ」 */
export const CUP_OPTIONS = Object.freeze([0.7, 1, 2, 3, 4]);
/** アイス（急冷）で、湯量のうち氷にする割合（湯6：氷4、D-127） */
export const ICE_SHARE = 0.4;

/** 量の選択肢の表示 */
export function cupsLabel(cups) {
  if (cups === 0.7) return '少なめ';
  return `${cups}杯`;
}

/**
 * 時間帯から気分の初期値を選ぶ（5〜10時は目覚め、18時以降は くつろぎ、ほかは なし）
 * @param {number} hour 0〜23
 */
export function moodForHour(hour) {
  if (hour >= 5 && hour < 11) return 'wake';
  if (hour >= 18 || hour < 2) return 'relax';
  return null;
}

/** 注湯を湯量に合わせて比例で直し、手で直していない投の注ぐ秒数を入れ直す */
function scalePours(pours, waterG, flowGps) {
  return fillPourSecs(scalePoursToWater(pours ?? [], waterG), flowGps ?? DEFAULT_FLOW_GPS);
}

/** 気分を当てはめる。雛形（4:6・基本形）のレシピは雛形で作り直し、そうでなければ湯量と注湯を比例で直す */
function applyMood(plan, moodKey) {
  const mood = MOODS[moodKey];
  if (!mood) return { plan, change: null };
  const ratio = ratioOf(plan.doseG, plan.waterG);
  if (!(plan.doseG > 0) || ratio == null) return { plan, change: { mood: moodKey } };
  const toRatio = round1(ratio + mood.ratioDelta);
  const t = plan.template;
  if (t && (t.kind === '46' || t.kind === 'basic')) {
    const template = { ...t, ratio: toRatio };
    if (t.kind === '46') {
      if (mood.taste) template.taste = mood.taste;
      if (mood.strength) template.strength = mood.strength;
    }
    const made = applyTemplate(template, plan.doseG, plan.flowGps);
    if (made) {
      return {
        plan: { ...plan, waterG: made.waterG, pours: made.pours, targetTotalSec: made.targetTotalSec, template },
        change: { mood: moodKey, fromRatio: ratio, toRatio, taste: t.kind === '46' ? template.taste : null, strength: t.kind === '46' ? template.strength : null },
      };
    }
  }
  const waterG = waterFromRatio(plan.doseG, toRatio);
  return {
    plan: { ...plan, waterG, pours: scalePours(plan.pours, waterG, plan.flowGps) },
    change: { mood: moodKey, fromRatio: ratio, toRatio, taste: null, strength: null },
  };
}

/** 数値の上書き（粉量・湯量・湯温・挽き目）。湯量が変わったら注湯を比例で直す */
export function applyOverrides(plan, o = {}) {
  if (!o || !Object.keys(o).length) return plan;
  const out = { ...plan };
  if (o.doseG != null) out.doseG = o.doseG;
  if (o.tempC != null) out.tempC = o.tempC;
  if (o.grind != null) out.grind = { ...(plan.grind ?? {}), setting: o.grind };
  if (o.waterG != null && o.waterG !== plan.waterG) {
    out.waterG = o.waterG;
    out.pours = scalePours(plan.pours, o.waterG, plan.flowGps);
  }
  if (o.doseG != null || o.waterG != null) out.template = null; // 雛形のつながりを外す（D-031と同じ考え方）
  return out;
}

/**
 * 計画に気分・数値の上書き・杯数・アイスを当てはめる。元の計画は変えない。
 * @param {object} plan planFromRecipe / planFromBrew などの計画
 * @param {{mood?:string|null, cups?:number, iced?:boolean, overrides?:object}} adj
 * @returns {object} 調整した計画（調整がなければ同じ内容の写し）。plan.adjust に何をしたかを残す
 */
export function adjustPlan(plan, adj = {}) {
  const mood = MOODS[adj.mood] ? adj.mood : null;
  const cups = CUP_OPTIONS.includes(adj.cups) ? adj.cups : 1;
  const iced = adj.iced === true;
  const hasOverrides = adj.overrides && Object.keys(adj.overrides).length > 0;
  if (!mood && cups === 1 && !iced && !hasOverrides) return { ...plan };

  let p = { ...plan, pours: (plan.pours ?? []).map((x) => ({ ...x })) };
  const adjust = { mood, cups, iceG: null, moodChange: null, base: { doseG: plan.doseG, waterG: plan.waterG } };

  if (mood) {
    const r = applyMood(p, mood);
    p = r.plan;
    adjust.moodChange = r.change;
  }
  if (hasOverrides) {
    p = applyOverrides(p, adj.overrides);
    adjust.overrides = { ...adj.overrides };
  }
  if (cups !== 1 && p.doseG > 0 && p.waterG > 0) {
    const waterG = Math.round(p.waterG * cups);
    p = { ...p, doseG: round1(p.doseG * cups), waterG, pours: scalePours(p.pours, waterG, p.flowGps), template: null };
  }
  if (iced && p.waterG > 0) {
    const hotG = Math.round(p.waterG * (1 - ICE_SHARE));
    adjust.iceG = p.waterG - hotG;
    p = { ...p, waterG: hotG, pours: scalePours(p.pours, hotG, p.flowGps), template: null };
  }
  p.ratio = ratioOf(p.doseG, p.waterG);
  p.adjust = adjust;
  return p;
}

/**
 * アイスで淹れた杯の計画（お湯だけの量）を、氷を足した元の湯量に戻す。
 * 「前回と同じ」などでアイスの杯を土台にするとき、もう一度アイスに分けられるようにする
 * @param {object} plan 杯から写した計画
 * @param {number} iceG その杯の氷（g）
 */
export function hotPlanOf(plan, iceG) {
  if (!(iceG > 0) || !(plan?.waterG > 0)) return plan;
  const waterG = plan.waterG + iceG;
  return { ...plan, waterG, pours: scalePours(plan.pours, waterG, plan.flowGps), ratio: ratioOf(plan.doseG, waterG), template: null };
}

/**
 * 計画をそのまま使い、氷の量だけを引き継ぐ（ダイヤルイン提案を入れた計画用。提案はお湯の量で計算してあるため）
 */
export function carryIce(plan, iceG) {
  if (!(iceG > 0)) return plan;
  return { ...plan, adjust: { mood: null, cups: 1, iceG, moodChange: null, base: { doseG: plan.doseG, waterG: plan.waterG + iceG } } };
}

/** 調整の説明（計画の画面に出す行） */
export function adjustNotes(plan) {
  const a = plan?.adjust;
  if (!a) return [];
  const lines = [];
  if (a.mood) {
    const m = MOODS[a.mood];
    const c = a.moodChange ?? {};
    const parts = [];
    if (c.fromRatio != null && c.toRatio != null && c.fromRatio !== c.toRatio) parts.push(`比率 1:${c.fromRatio} → 1:${c.toRatio}`);
    if (c.taste) parts.push(`4:6の味を${TASTES_46[c.taste]}`);
    if (c.strength) parts.push(`濃さを${STRENGTHS_46[c.strength]}`);
    lines.push(`気分「${m.label}」（${m.aim}）${parts.length ? '：' + parts.join('、') : ''}`);
  }
  if (a.overrides) lines.push('数値を指定どおりに入れました');
  if (a.cups !== 1) lines.push(`${cupsLabel(a.cups)}ぶん：粉量と湯量を${a.cups}倍にしました${a.cups > 1 ? '（量が多いと落ち切りが遅くなります）' : ''}`);
  if (a.iceG != null) lines.push(`アイス：お湯 ${plan.waterG}g を注ぎ、サーバーに氷 ${a.iceG}g を入れておきます。挽き目は1目盛り細かくするのがおすすめです`);
  return lines;
}

/** 抽出の記録の context（気分・杯数・氷）。調整のない計画は {} */
export function contextFromPlan(plan) {
  const a = plan?.adjust;
  if (!a) return {};
  const out = {};
  if (a.mood) out.mood = a.mood;
  if (a.cups !== 1) out.cups = a.cups;
  if (a.iceG != null) out.iceG = a.iceG;
  return out;
}

/** アイス（急冷）で淹れた杯か */
export const isIced = (brew) => brew?.context?.iceG > 0;

/** 杯数（A6）を変えて淹れた杯の杯数（0.7・2・3・4）。変えていなければ 1 */
export function cupsOf(brew) {
  const c = Number(brew?.context?.cups);
  return CUP_OPTIONS.includes(c) ? c : 1;
}

/**
 * 杯数を変えて淹れた杯の計画を、1杯分に戻す（2-8 の7番）。
 * 「2杯」「少なめ」で淹れた杯を土台にしても、次の計画が倍（0.7倍）の量のままにならないように
 * @param {object} plan 杯から写した計画
 * @param {number} cups その杯の杯数（cupsOf）
 */
export function perCupPlan(plan, cups) {
  if (!(cups > 0) || cups === 1 || !(plan?.doseG > 0) || !(plan?.waterG > 0)) return plan;
  const doseG = round1(plan.doseG / cups);
  const waterG = Math.round(plan.waterG / cups);
  return { ...plan, doseG, waterG, pours: scalePours(plan.pours, waterG, plan.flowGps), ratio: ratioOf(doseG, waterG), template: null };
}

/** その杯の1杯分の氷（g）。アイスでなければ null */
export function perCupIceG(brew) {
  return isIced(brew) ? Math.round(brew.context.iceG / cupsOf(brew)) : null;
}

const RANGES = Object.freeze({ doseG: [3, 80], waterG: [30, 1500], tempC: [60, 100] });

/** 範囲の中の数か。外なら null */
function inRange(v, key) {
  const n = typeof v === 'number' ? v : parseNumber(v);
  if (n == null || Number.isNaN(n)) return null;
  const [lo, hi] = RANGES[key];
  return n >= lo && n <= hi ? n : null;
}

/** 数値の上書きを確かめる（範囲の外や読めない値は捨てる） */
export function normalizeOverrides(raw = {}) {
  const o = {};
  const dose = inRange(raw.doseG, 'doseG');
  if (dose != null) o.doseG = round1(dose);
  const water = inRange(raw.waterG, 'waterG');
  if (water != null) o.waterG = Math.round(water);
  const temp = inRange(raw.tempC, 'tempC');
  if (temp != null) o.tempC = Math.round(temp);
  const grind = String(raw.grind ?? '').normalize('NFKC').trim();
  if (grind && grind.length <= 20) o.grind = grind;
  return o;
}

/**
 * URL の調整（?mood=wake&cups=2&iced=1&dose=20&water=300&temp=92&grind=24）を読む。
 * 知らない値・範囲の外の値は無視する。iced は 1＝アイス、0＝ホット、なし＝null（土台の杯に合わせる）
 * @param {(key:string)=>string|null} get
 */
export function parseAdjustParams(get) {
  const mood = MOODS[get('mood')] ? get('mood') : null;
  const cupsN = Number(get('cups'));
  const cups = CUP_OPTIONS.includes(cupsN) ? cupsN : 1;
  const iced = get('iced') === '1' ? true : get('iced') === '0' ? false : null; // null は「土台の杯に合わせる」
  const overrides = normalizeOverrides({ doseG: get('dose'), waterG: get('water'), tempC: get('temp'), grind: get('grind') });
  return { mood, cups, iced, overrides };
}

/** 調整を URL の文字にする（先頭の & なし。調整がなければ空文字）。icedDefault は土台の杯がアイスだったとき true（ホットを iced=0 で残す） */
export function adjustQuery({ mood = null, cups = 1, iced = false, overrides = {} } = {}, icedDefault = false) {
  const q = new URLSearchParams();
  if (MOODS[mood]) q.set('mood', mood);
  if (CUP_OPTIONS.includes(cups) && cups !== 1) q.set('cups', String(cups));
  if (iced === true) q.set('iced', '1');
  else if (iced === false && icedDefault) q.set('iced', '0');
  const o = normalizeOverrides(overrides);
  if (o.doseG != null) q.set('dose', String(o.doseG));
  if (o.waterG != null) q.set('water', String(o.waterG));
  if (o.tempC != null) q.set('temp', String(o.tempC));
  if (o.grind != null) q.set('grind', o.grind);
  return q.toString();
}
