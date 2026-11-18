// 天気の取得と、杯への書き込み（X16）。計算は js/core/weather.js
// 受け取った天気はこの端末の localStorage に置く（書き出しには入れない。杯に入れた値は杯の記録に残る）。
// 地点を決めていない・通信できない・失敗したときは何もしない（ほかの機能はそのまま動く）。
import { placeOf, weatherUrl, parseWeather, needsFetch, fillTargets } from './core/weather.js';
import { setBrewWeather } from './db.js';

const KEY = 'pourfolio.weather';
const TIMEOUT_MS = 10000;

/** 置いてある天気（なければ null） */
export function loadWeatherCache() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return c && typeof c === 'object' && Array.isArray(c.temp) ? c : null;
  } catch {
    return null;
  }
}

function saveCache(c) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* 置けない環境では、次に開いたときにまた問い合わせる */
  }
}

/** 置いてある天気を消す（地点を消したとき） */
export function clearWeatherCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* なにもしない */
  }
}

/**
 * 天気を問い合わせる（地点を変えたときは force）。
 * @returns {Promise<{cache:object|null, error:string|null}>}
 */
export async function fetchWeather(place, { force = false, now = new Date() } = {}) {
  const cache = loadWeatherCache();
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!place) return { cache: null, error: null };
  if (!force && !needsFetch({ cache, place, now, online })) return { cache, error: null };
  if (!online) return { cache, error: '通信できません' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // cache などの指定や独自のヘッダーは付けない。Safari は cache: 'no-store' で Cache-Control・Pragma のヘッダーを足し、
    // 事前の確認（CORSのプリフライト）が Open-Meteo に通らず「Load failed」になる（3-3 のiPhone確認）。
    // 古い天気が返らないかは、問い合わせの間隔（needsFetch）と受け取った時刻で見る
    const res = await fetch(weatherUrl(place), { signal: ctrl.signal });
    if (!res.ok) return { cache, error: `天気を受け取れませんでした（${res.status}）` };
    const next = parseWeather(await res.json(), place, now);
    if (!next) return { cache, error: '天気の中身を読めませんでした' };
    saveCache(next);
    return { cache: next, error: null };
  } catch (err) {
    console.warn('天気を取れませんでした', err);
    const why = err?.name === 'AbortError' ? '時間切れ' : String(err?.message ?? err).slice(0, 60);
    return { cache, error: `天気を受け取れませんでした（通信を確かめてください：${why}）` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 必要なら天気を問い合わせ、まだ天気のない杯に入れる
 * @param {object} db
 * @param {{settings:object, brews:object[], now?:Date, force?:boolean}} p
 * @returns {Promise<{cache:object|null, filled:number, error:string|null}>}
 */
export async function syncWeather(db, { settings, brews = [], now = new Date(), force = false }) {
  const place = placeOf(settings);
  if (!place) return { cache: null, filled: 0, error: null };
  const { cache, error } = await fetchWeather(place, { force, now });
  // 地点を変えたあとの古い天気は使わない
  const usable = cache && cache.lat === place.lat && cache.lon === place.lon ? cache : null;
  let filled = 0;
  try {
    filled = await setBrewWeather(db, fillTargets(brews, usable, now), now);
  } catch (err) {
    console.error(err);
  }
  return { cache: usable, filled, error };
}
