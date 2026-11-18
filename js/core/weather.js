// 天気の自動記録（X16、純粋関数）
// 天気は Open-Meteo（無料・APIキー不要、出典の表示が必要）から、設定した地点だけを問い合わせる。位置情報の許可は使わない（spec 10.6）。
// 抽出のたびには通信しない。ホームなどを開いたときに1回、過去92日分＋今日の1時間ごとの気温・湿度・天気を受け取り、
// まだ天気の付いていない杯に、その杯の時刻の値をあとから入れる（通信できない日に淹れた杯も、次に開いたときに埋まる。D-163）。
// 杯の記録の形は spec 9章の context.weather = { tempC, humidity, code }。

/** 出典の表示（Open-Meteo の利用条件） */
export const WEATHER_CREDIT = 'Weather data by Open-Meteo.com';
export const WEATHER_CREDIT_URL = 'https://open-meteo.com/';
/** 問い合わせ先 */
export const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';
/** さかのぼる日数（Open-Meteo の forecast で取れる最大） */
export const PAST_DAYS = 92;
/** 問い合わせの間隔（分）。これより短い間隔では問い合わせない */
export const FETCH_INTERVAL_MIN = 60;
/** 暑い日の線（今日の最高気温、℃）の初期値と、選べる範囲 */
export const DEFAULT_HOT_C = 28;
export const HOT_C_RANGE = Object.freeze({ min: 20, max: 40 });

const HOUR_SEC = 3600;
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * 地点の一覧：都道府県庁所在地（D-163）。選ぶときは通信しない。緯度・経度は小数2桁（約1km）
 * name は画面に出す名前
 */
export const PLACES = Object.freeze(
  [
    ['hokkaido', '北海道（札幌）', 43.06, 141.35],
    ['aomori', '青森県（青森）', 40.82, 140.74],
    ['iwate', '岩手県（盛岡）', 39.7, 141.15],
    ['miyagi', '宮城県（仙台）', 38.27, 140.87],
    ['akita', '秋田県（秋田）', 39.72, 140.1],
    ['yamagata', '山形県（山形）', 38.24, 140.36],
    ['fukushima', '福島県（福島）', 37.75, 140.47],
    ['ibaraki', '茨城県（水戸）', 36.34, 140.45],
    ['tochigi', '栃木県（宇都宮）', 36.57, 139.88],
    ['gunma', '群馬県（前橋）', 36.39, 139.06],
    ['saitama', '埼玉県（さいたま）', 35.86, 139.65],
    ['chiba', '千葉県（千葉）', 35.61, 140.12],
    ['tokyo', '東京都（新宿）', 35.69, 139.69],
    ['kanagawa', '神奈川県（横浜）', 35.45, 139.64],
    ['niigata', '新潟県（新潟）', 37.9, 139.02],
    ['toyama', '富山県（富山）', 36.7, 137.21],
    ['ishikawa', '石川県（金沢）', 36.59, 136.63],
    ['fukui', '福井県（福井）', 36.07, 136.22],
    ['yamanashi', '山梨県（甲府）', 35.66, 138.57],
    ['nagano', '長野県（長野）', 36.65, 138.18],
    ['gifu', '岐阜県（岐阜）', 35.39, 136.72],
    ['shizuoka', '静岡県（静岡）', 34.98, 138.38],
    ['aichi', '愛知県（名古屋）', 35.18, 136.91],
    ['mie', '三重県（津）', 34.73, 136.51],
    ['shiga', '滋賀県（大津）', 35.0, 135.87],
    ['kyoto', '京都府（京都）', 35.02, 135.76],
    ['osaka', '大阪府（大阪）', 34.69, 135.52],
    ['hyogo', '兵庫県（神戸）', 34.69, 135.18],
    ['nara', '奈良県（奈良）', 34.69, 135.83],
    ['wakayama', '和歌山県（和歌山）', 34.23, 135.17],
    ['tottori', '鳥取県（鳥取）', 35.5, 134.24],
    ['shimane', '島根県（松江）', 35.47, 133.05],
    ['okayama', '岡山県（岡山）', 34.66, 133.93],
    ['hiroshima', '広島県（広島）', 34.4, 132.46],
    ['yamaguchi', '山口県（山口）', 34.19, 131.47],
    ['tokushima', '徳島県（徳島）', 34.07, 134.56],
    ['kagawa', '香川県（高松）', 34.34, 134.04],
    ['ehime', '愛媛県（松山）', 33.84, 132.77],
    ['kochi', '高知県（高知）', 33.56, 133.53],
    ['fukuoka', '福岡県（福岡）', 33.61, 130.42],
    ['saga', '佐賀県（佐賀）', 33.25, 130.3],
    ['nagasaki', '長崎県（長崎）', 32.74, 129.87],
    ['kumamoto', '熊本県（熊本）', 32.79, 130.74],
    ['oita', '大分県（大分）', 33.24, 131.61],
    ['miyazaki', '宮崎県（宮崎）', 31.91, 131.42],
    ['kagoshima', '鹿児島県（鹿児島）', 31.56, 130.56],
    ['okinawa', '沖縄県（那覇）', 26.21, 127.68],
  ].map(([key, name, lat, lon]) => Object.freeze({ key, name, lat, lon })),
);

/** 一覧の地点（なければ null） */
export const placeByKey = (key) => PLACES.find((p) => p.key === key) ?? null;

/**
 * 地点の入力を確かめる。一覧から選ぶ（key）か、緯度・経度を手で入れる（key は 'custom'）。
 * 緯度・経度は小数2桁に丸める（細かい場所を外に送らない）
 * @param {{key?:string, lat?:string|number, lon?:string|number, name?:string}} raw
 * @returns {{value:{key:string, name:string, lat:number, lon:number}|null, errors:Record<string,string>}}
 */
export function normalizePlace(raw = {}) {
  const key = String(raw.key ?? '').trim();
  if (!key) return { value: null, errors: {} };
  if (key !== 'custom') {
    const p = placeByKey(key);
    return p ? { value: { key: p.key, name: p.name, lat: p.lat, lon: p.lon }, errors: {} } : { value: null, errors: { key: '一覧から選んでください' } };
  }
  const errors = {};
  const toNum = (v) => {
    const s = String(v ?? '').normalize('NFKC').trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };
  const lat = toNum(raw.lat);
  const lon = toNum(raw.lon);
  if (lat == null) errors.lat = '緯度を入れてください';
  else if (Number.isNaN(lat) || lat < -90 || lat > 90) errors.lat = '緯度は -90〜90 の数で入れてください（例：35.68）';
  if (lon == null) errors.lon = '経度を入れてください';
  else if (Number.isNaN(lon) || lon < -180 || lon > 180) errors.lon = '経度は -180〜180 の数で入れてください（例：139.76）';
  if (Object.keys(errors).length) return { value: null, errors };
  const name = String(raw.name ?? '').trim().slice(0, 30) || '手で入れた地点';
  return { value: { key: 'custom', name, lat: r2(lat), lon: r2(lon) }, errors };
}

/** 設定に入っている地点（壊れていれば null） */
export function placeOf(settings) {
  const p = settings?.weatherPlace;
  if (!p || num(p.lat) == null || num(p.lon) == null) return null;
  if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) return null;
  return { key: String(p.key ?? 'custom'), name: String(p.name ?? ''), lat: r2(p.lat), lon: r2(p.lon) };
}

/** 暑い日の線（設定がなければ初期値） */
export function hotLineOf(settings) {
  const v = num(settings?.hotDayC);
  return v != null && v >= HOT_C_RANGE.min && v <= HOT_C_RANGE.max ? Math.round(v) : DEFAULT_HOT_C;
}

/**
 * 問い合わせのURL。送るのは地点（小数2桁）と、欲しい項目だけ
 * @param {{lat:number, lon:number}} place
 */
export function weatherUrl(place, pastDays = PAST_DAYS) {
  const q = new URLSearchParams({
    latitude: r2(place.lat).toFixed(2),
    longitude: r2(place.lon).toFixed(2),
    hourly: 'temperature_2m,relative_humidity_2m,weather_code',
    daily: 'temperature_2m_max',
    timezone: 'auto',
    timeformat: 'unixtime',
    past_days: String(pastDays),
    forecast_days: '1',
  });
  return `${WEATHER_API}?${q}`;
}

/**
 * 返ってきた中身を、端末に置いておく形にする。読めないときは null
 * @returns {null|{fetchedAt:string, lat:number, lon:number, offsetSec:number, t0:number, temp:(number|null)[], hum:(number|null)[], code:(number|null)[], days:{ymd:string, maxC:number|null}[]}}
 */
export function parseWeather(json, place, fetchedAt = new Date()) {
  const h = json?.hourly;
  const times = Array.isArray(h?.time) ? h.time : null;
  if (!times || !times.length || !times.every((t) => num(t) != null)) return null;
  // 1時間ごとに並んでいること（あとで杯の時刻から位置を計算するため）
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] !== HOUR_SEC) return null;
  const col = (a) => times.map((_, i) => (Array.isArray(a) ? num(a[i]) : null));
  const offsetSec = num(json.utc_offset_seconds) ?? 0;
  const dt = Array.isArray(json.daily?.time) ? json.daily.time : [];
  const dmax = Array.isArray(json.daily?.temperature_2m_max) ? json.daily.temperature_2m_max : [];
  const days = dt.filter((t) => num(t) != null).map((t, i) => ({ ymd: ymdAt(t, offsetSec), maxC: num(dmax[i]) }));
  return {
    fetchedAt: new Date(fetchedAt).toISOString(),
    lat: r2(place.lat),
    lon: r2(place.lon),
    offsetSec,
    t0: times[0],
    temp: col(h.temperature_2m),
    hum: col(h.relative_humidity_2m),
    code: col(h.weather_code),
    days,
  };
}

/** 地点の時刻での日付（YYYY-MM-DD） */
function ymdAt(unixSec, offsetSec) {
  return new Date((unixSec + offsetSec) * 1000).toISOString().slice(0, 10);
}

/** 置いてある天気が、その地点のものか */
const samePlace = (cache, place) => !!cache && !!place && cache.lat === r2(place.lat) && cache.lon === r2(place.lon);

/**
 * 問い合わせるか。地点がない・通信できないときはしない。前回から FETCH_INTERVAL_MIN 分たっていないときもしない（地点を変えたときは別）
 */
export function needsFetch({ cache = null, place = null, now = new Date(), online = true } = {}) {
  if (!place || !online) return false;
  if (!samePlace(cache, place)) return true;
  const last = Date.parse(cache.fetchedAt);
  if (Number.isNaN(last)) return true;
  const ago = new Date(now).getTime() - last;
  return ago < 0 || ago >= FETCH_INTERVAL_MIN * 60 * 1000;
}

/**
 * ある時刻の天気（その時刻を含む1時間の値）。範囲の外・値がないときは null
 * @returns {null|{tempC:number, humidity:number|null, code:number|null}}
 */
export function weatherAt(cache, at) {
  if (!cache || !Array.isArray(cache.temp)) return null;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  const i = Math.floor((ms / 1000 - cache.t0) / HOUR_SEC);
  if (i < 0 || i >= cache.temp.length) return null;
  const tempC = num(cache.temp[i]);
  if (tempC == null) return null;
  return { tempC: r1(tempC), humidity: num(cache.hum?.[i]) == null ? null : Math.round(cache.hum[i]), code: num(cache.code?.[i]) };
}

/** 杯に付いている天気（気温のないものは「ない」とみなす） */
export function brewWeather(brew) {
  const w = brew?.context?.weather;
  return w && num(w.tempC) != null ? w : null;
}

/**
 * 天気を入れる杯の一覧：削除していない、天気がまだない、淹れた時刻が今より前で、置いてある天気の範囲に入る杯
 * @returns {{id:string, weather:{tempC:number, humidity:number|null, code:number|null}}[]}
 */
export function fillTargets(brews = [], cache = null, now = new Date()) {
  if (!cache) return [];
  const nowMs = new Date(now).getTime();
  const out = [];
  for (const b of brews ?? []) {
    if (!b || b.deletedAt != null || b.context?.weather) continue;
    const ms = Date.parse(b.at);
    if (Number.isNaN(ms) || ms > nowMs) continue;
    const w = weatherAt(cache, b.at);
    if (w) out.push({ id: b.id, weather: w });
  }
  return out;
}

/** 杯の context に天気を足す（ほかの項目はそのまま） */
export function withWeather(brew, weather) {
  return { ...(brew.context ?? {}), weather: { tempC: weather.tempC, humidity: weather.humidity ?? null, code: weather.code ?? null } };
}

/**
 * 今日（地点の日付）の最高気温。置いてある天気に今日がなければ null
 */
export function todayMaxC(cache, now = new Date()) {
  if (!cache || !Array.isArray(cache.days)) return null;
  const ymd = ymdAt(Math.floor(new Date(now).getTime() / 1000), cache.offsetSec ?? 0);
  const d = cache.days.find((x) => x.ymd === ymd);
  return d && d.maxC != null ? r1(d.maxC) : null;
}

/**
 * 暑い日か（今日の最高気温が線以上）
 * @returns {{hot:boolean, maxC:number|null, line:number, ymd:string|null}}
 */
export function hotDay({ cache = null, now = new Date(), line = DEFAULT_HOT_C } = {}) {
  const maxC = todayMaxC(cache, now);
  const ymd = cache ? ymdAt(Math.floor(new Date(now).getTime() / 1000), cache.offsetSec ?? 0) : null;
  return { hot: maxC != null && maxC >= line, maxC, line, ymd };
}

/** 天気の種類（WMOの天気コードを4つにまとめる） */
export const WEATHER_GROUPS = Object.freeze({
  sunny: { label: '晴れ' },
  cloudy: { label: 'くもり' },
  rain: { label: '雨' },
  snow: { label: '雪' },
});

/** 天気コードの種類。わからなければ null */
export function weatherGroup(code) {
  const c = num(code);
  if (c == null) return null;
  if (c <= 1) return 'sunny';
  if (c <= 3 || c === 45 || c === 48) return 'cloudy';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95) return 'rain';
  return null;
}

/** 「9.5℃・湿度62%・晴れ」 */
export function weatherText(w) {
  if (!w || num(w.tempC) == null) return '';
  const g = weatherGroup(w.code);
  return [`${r1(w.tempC)}℃`, num(w.humidity) != null ? `湿度${Math.round(w.humidity)}%` : '', g ? WEATHER_GROUPS[g].label : ''].filter(Boolean).join('・');
}
