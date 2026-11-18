// 共有リンク（X11）とQR共有（X10）：レシピ（と豆の基本情報）を URL の # のうしろに詰める（純粋関数）
// # のうしろはサーバーに送られないので、どこにも保存されない（spec 7.2）。
// 中身：JSON → UTF-8 → deflate-raw で圧縮 → base64url。先頭に形式の印「1.」（圧縮なしは「0.」）。
// メモ・価格・日付・器具のID・お気に入りなど、自分の記録や端末に結び付く情報は入れない（D-138）。

import { normalizeRecipeInput, POUR_STYLES } from './recipes.js';
import { ROAST_LEVELS } from './roast.js';

/** 共有の中身の版 */
export const SHARE_VERSION = 1;
/** 共有の中身を入れる # のうしろの名前（share.html#r=...） */
export const SHARE_KEY = 'r';
/** QRに詰める URL の上限（文字）。誤り訂正 M で読み取りやすい大きさに収める */
export const QR_MAX_CHARS = 1200;

const str = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * レシピ（と豆）から共有する中身を作る。器具は名前（文字）だけを添える。
 * @param {{recipe:object, bean?:object|null, grinderName?:string, dripperName?:string}} p
 */
export function sharePayload({ recipe, bean = null, grinderName = '', dripperName = '' }) {
  const out = {
    app: 'pourfolio',
    v: SHARE_VERSION,
    recipe: {
      name: str(recipe.name),
      doseG: num(recipe.doseG),
      waterG: num(recipe.waterG),
      tempC: num(recipe.tempC),
      grindSetting: str(recipe.grind?.setting, 20),
      grinderName: str(grinderName),
      dripperName: str(dripperName),
      pours: (recipe.pours ?? []).map((p) => {
        const o = { atSec: num(p.atSec), toG: num(p.toG) };
        if (p.style) o.style = p.style;
        if (num(p.pourSec) != null) o.pourSec = p.pourSec;
        return o;
      }),
      bloomStir: Boolean(recipe.bloom?.stir),
      targetTotalSec: num(recipe.targetTotalSec),
      flowGps: num(recipe.flowGps),
      template: recipe.template ?? null,
    },
  };
  if (bean) {
    out.bean = {
      name: str(bean.name),
      shop: str(bean.shop),
      productUrl: /^https?:\/\/\S+$/i.test(bean.productUrl ?? '') ? str(bean.productUrl, 300) : '',
      country: str(bean.origin?.country),
      region: str(bean.origin?.region),
      farm: str(bean.origin?.farm),
      variety: str(bean.variety),
      process: str(bean.process),
      roastLevel: str(bean.roastLevel, 20),
      flavorNotes: str(bean.flavorNotes, 200),
    };
  }
  return out;
}

// ---- base64url（Node と ブラウザの両方で動くように btoa / atob を使う） ----

export function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/**
 * 中身を # のうしろに入れる文字にする（「1.」＋圧縮した base64url）
 * @param {object} payload
 * @param {{compress?:boolean}} [opt] compress:false は圧縮できない端末と同じ形（テスト用）
 */
export async function encodeShare(payload, { compress = canCompress() } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (!compress) return `0.${toBase64Url(bytes)}`;
  return `1.${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
}

/**
 * 共有の文字を中身に戻す。壊れている・別のアプリのものなら理由つきで返す
 * @returns {Promise<{ok:true, payload:object}|{ok:false, error:string}>}
 */
export async function decodeShare(code) {
  const bad = { ok: false, error: 'リンクが壊れているか、途中で切れています。もう一度もらってください' };
  const m = /^([01])\.([A-Za-z0-9_-]+)$/.exec(String(code ?? '').trim());
  if (!m) return bad;
  let payload;
  try {
    let bytes = fromBase64Url(m[2]);
    if (m[1] === '1') {
      if (!canCompress()) return { ok: false, error: 'このブラウザでは開けません。新しいSafariかChromeで開いてください' };
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return bad;
  }
  if (payload?.app !== 'pourfolio' || !payload.recipe) return { ok: false, error: 'Pourfolioのレシピのリンクではありません' };
  if (payload.v > SHARE_VERSION) return { ok: false, error: 'アプリを新しい版に更新してから開いてください' };
  return { ok: true, payload };
}

/** 共有リンクの URL（base はアプリの場所。例 https://…/pourfolio/） */
export function shareUrl(base, code) {
  return `${new URL('share.html', base).href}#${SHARE_KEY}=${code}`;
}

/** location.hash（#r=...）から共有の文字を取り出す */
export function codeFromHash(hash) {
  const q = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  return q.get(SHARE_KEY);
}

/**
 * 取り込むレシピ（normalizeRecipeInput の入力の形）。器具は端末ごとに違うので選ばない。
 * 豆の情報は、取り込んだレシピのメモに残す。
 * @returns {{value:object|null, errors:Record<string,string>}}
 */
export function recipeInputFromShare(payload) {
  const r = payload.recipe ?? {};
  const pours = Array.isArray(r.pours)
    ? r.pours.slice(0, 20).map((p) => ({
        atSec: num(p?.atSec),
        toG: num(p?.toG),
        style: Object.hasOwn(POUR_STYLES, p?.style) ? p.style : '',
        pourSec: num(p?.pourSec),
      }))
    : [];
  const memo = [
    '共有リンクから取り込みました',
    r.grinderName || r.grindSetting ? `挽き目：${[r.grinderName, r.grindSetting].filter(Boolean).join(' ')}` : '',
    r.dripperName ? `ドリッパー：${r.dripperName}` : '',
    payload.bean ? `豆：${beanLine(payload.bean)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return normalizeRecipeInput({
    name: str(r.name) || '共有されたレシピ',
    doseG: num(r.doseG),
    waterG: num(r.waterG),
    tempC: num(r.tempC),
    grinderId: '',
    grindSetting: str(r.grindSetting, 20),
    dripperId: '',
    filterId: '',
    kettleId: '',
    pours,
    bloomStir: Boolean(r.bloomStir),
    targetTotalSec: num(r.targetTotalSec),
    flowGps: num(r.flowGps),
    template: r.template ?? null,
    favorite: false,
    memo,
  });
}

/** 豆の情報の1行「ケニア ニエリ・ウォッシュト・シティ（珈琲問屋）」 */
export function beanLine(b) {
  if (!b) return '';
  const origin = [b.country, b.region, b.farm].filter(Boolean).join(' ');
  const roast = ROAST_LEVELS.includes(b.roastLevel) ? b.roastLevel : '';
  const attrs = [origin, b.variety, b.process, roast].filter(Boolean).join('・');
  return `${b.name || '名前なし'}${attrs ? `（${attrs}）` : ''}${b.shop ? `／${b.shop}` : ''}`;
}
