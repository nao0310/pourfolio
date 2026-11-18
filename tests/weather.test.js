// 天気の自動記録（X16）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACES, placeByKey, normalizePlace, placeOf, hotLineOf, weatherUrl, parseWeather, needsFetch, weatherAt, fillTargets,
  withWeather, todayMaxC, hotDay, weatherGroup, weatherText, brewWeather, DEFAULT_HOT_C, PAST_DAYS,
} from '../js/core/weather.js';

const TOKYO = placeByKey('tokyo');
// 2026-11-18 00:00 JST = 2026-11-17T15:00Z
const T0 = Date.parse('2026-11-17T15:00:00Z') / 1000;
function sample({ hours = 48, offset = 32400 } = {}) {
  const time = Array.from({ length: hours }, (_, i) => T0 + i * 3600);
  return {
    utc_offset_seconds: offset,
    hourly: {
      time,
      temperature_2m: time.map((_, i) => 10 + i * 0.25),
      relative_humidity_2m: time.map((_, i) => 50 + (i % 10)),
      weather_code: time.map((_, i) => (i < 24 ? 0 : 61)),
    },
    daily: { time: [T0, T0 + 86400], temperature_2m_max: [18.4, 29.1] },
  };
}

test('地点の一覧は47都道府県で、キーが重ならず、日本の範囲に入る', () => {
  assert.equal(PLACES.length, 47);
  assert.equal(new Set(PLACES.map((p) => p.key)).size, 47);
  for (const p of PLACES) {
    assert.ok(p.lat > 24 && p.lat < 46 && p.lon > 122 && p.lon < 146, p.name);
  }
});

test('地点の入力：一覧から選ぶ・手で入れる（小数2桁に丸める）・間違い', () => {
  assert.deepEqual(normalizePlace({ key: 'tokyo' }).value, { key: 'tokyo', name: '東京都（新宿）', lat: 35.69, lon: 139.69 });
  assert.deepEqual(normalizePlace({ key: 'custom', lat: '３５．６８１２', lon: '139.7671', name: '' }).value, { key: 'custom', name: '手で入れた地点', lat: 35.68, lon: 139.77 });
  assert.equal(normalizePlace({ key: '' }).value, null);
  assert.ok(normalizePlace({ key: 'mars' }).errors.key);
  const bad = normalizePlace({ key: 'custom', lat: '100', lon: 'abc' });
  assert.equal(bad.value, null);
  assert.ok(bad.errors.lat && bad.errors.lon);
  assert.ok(normalizePlace({ key: 'custom', lat: '', lon: '1' }).errors.lat);
});

test('設定の地点と暑い日の線（壊れた値は使わない）', () => {
  assert.equal(placeOf({}), null);
  assert.equal(placeOf({ weatherPlace: { lat: 'x', lon: 1 } }), null);
  assert.equal(placeOf({ weatherPlace: { lat: 95, lon: 1 } }), null);
  assert.deepEqual(placeOf({ weatherPlace: { key: 'tokyo', name: '東京', lat: 35.6912, lon: 139.69 } }), { key: 'tokyo', name: '東京', lat: 35.69, lon: 139.69 });
  assert.equal(hotLineOf({}), DEFAULT_HOT_C);
  assert.equal(hotLineOf({ hotDayC: 30 }), 30);
  assert.equal(hotLineOf({ hotDayC: 99 }), DEFAULT_HOT_C);
});

test('問い合わせのURLには、地点（小数2桁）と欲しい項目だけが入る', () => {
  const u = new URL(weatherUrl({ lat: 35.681234, lon: 139.767125 }));
  assert.equal(u.origin, 'https://api.open-meteo.com');
  assert.equal(u.searchParams.get('latitude'), '35.68');
  assert.equal(u.searchParams.get('longitude'), '139.77');
  assert.equal(u.searchParams.get('past_days'), String(PAST_DAYS));
  assert.deepEqual([...u.searchParams.keys()].sort(), ['daily', 'forecast_days', 'hourly', 'latitude', 'longitude', 'past_days', 'timeformat', 'timezone']);
  assert.ok(!/key|token/i.test(u.search));
});

test('返ってきた中身を読む。壊れた中身・欠けた値でも落ちない', () => {
  const c = parseWeather(sample(), TOKYO, new Date('2026-11-19T03:00:00Z'));
  assert.equal(c.t0, T0);
  assert.equal(c.temp.length, 48);
  assert.deepEqual(c.days, [{ ymd: '2026-11-18', maxC: 18.4 }, { ymd: '2026-11-19', maxC: 29.1 }]);
  assert.equal(parseWeather(null, TOKYO), null);
  assert.equal(parseWeather({ hourly: { time: [] } }, TOKYO), null);
  assert.equal(parseWeather({ hourly: { time: [T0, T0 + 1800] } }, TOKYO), null, '1時間ごとでない');
  const holes = sample();
  holes.hourly.temperature_2m[3] = null;
  delete holes.hourly.relative_humidity_2m;
  const h = parseWeather(holes, TOKYO);
  assert.equal(weatherAt(h, new Date((T0 + 3 * 3600 + 60) * 1000).toISOString()), null, '気温のない時間は付けない');
  assert.deepEqual(weatherAt(h, new Date((T0 + 4 * 3600) * 1000).toISOString()), { tempC: 11, humidity: null, code: 0 });
});

test('杯の時刻を含む1時間の値を、時差込みで選ぶ', () => {
  const c = parseWeather(sample(), TOKYO);
  // 2026-11-18 07:42 JST は 0時から7時間目
  assert.deepEqual(weatherAt(c, '2026-11-18T07:42:00+09:00'), { tempC: 11.8, humidity: 57, code: 0 });
  assert.deepEqual(weatherAt(c, '2026-11-17T22:59:59Z'), weatherAt(c, '2026-11-18T07:00:00+09:00'));
  assert.equal(weatherAt(c, '2026-11-17T14:59:00Z'), null, '範囲より前');
  assert.equal(weatherAt(c, '2026-11-20T00:00:00+09:00'), null, '範囲より後');
  assert.equal(weatherAt(c, 'こわれた'), null);
});

test('天気を入れる杯：天気がない・今より前・範囲の中・削除していない杯だけ', () => {
  const c = parseWeather(sample(), TOKYO);
  const now = new Date('2026-11-19T09:00:00+09:00');
  const brews = [
    { id: 'a', at: '2026-11-18T07:42:00+09:00', context: {}, deletedAt: null },
    { id: 'b', at: '2026-11-18T08:00:00+09:00', context: { weather: { tempC: 3, humidity: 1, code: 0 } }, deletedAt: null },
    { id: 'c', at: '2026-11-18T09:00:00+09:00', context: {}, deletedAt: '2026-11-18T10:00:00Z' },
    { id: 'd', at: '2026-11-19T10:00:00+09:00', context: {}, deletedAt: null },
    { id: 'e', at: '2026-08-01T10:00:00+09:00', deletedAt: null },
    { id: 'f', at: '2026-11-19T08:10:00+09:00', deletedAt: null },
  ];
  const t = fillTargets(brews, c, now);
  assert.deepEqual(t.map((x) => x.id), ['a', 'f']);
  assert.equal(t[1].weather.code, 61);
  assert.deepEqual(fillTargets(brews, null, now), []);
  const ctx = withWeather({ context: { mood: 'wake', cups: 2 } }, t[0].weather);
  assert.deepEqual(ctx, { mood: 'wake', cups: 2, weather: { tempC: 11.8, humidity: 57, code: 0 } });
  assert.equal(brewWeather({ context: { weather: { tempC: null } } }), null);
});

test('問い合わせは地点があり通信できるときだけ、前回から1時間たったら（地点を変えたらすぐ）', () => {
  const c = parseWeather(sample(), TOKYO, new Date('2026-11-18T00:00:00Z'));
  assert.equal(needsFetch({ cache: c, place: null }), false);
  assert.equal(needsFetch({ cache: null, place: TOKYO, online: false }), false);
  assert.equal(needsFetch({ cache: null, place: TOKYO }), true);
  assert.equal(needsFetch({ cache: c, place: TOKYO, now: new Date('2026-11-18T00:59:00Z') }), false);
  assert.equal(needsFetch({ cache: c, place: TOKYO, now: new Date('2026-11-18T01:00:00Z') }), true);
  assert.equal(needsFetch({ cache: c, place: placeByKey('osaka'), now: new Date('2026-11-18T00:10:00Z') }), true);
  assert.equal(needsFetch({ cache: c, place: TOKYO, now: new Date('2026-11-17T23:00:00Z') }), true, '時計が戻ったら取り直す');
});

test('暑い日：地点の今日の最高気温が線以上', () => {
  const c = parseWeather(sample(), TOKYO);
  // 2026-11-19 08:00 JST（UTCでは18日）でも、地点の日付で「19日」を見る
  assert.equal(todayMaxC(c, new Date('2026-11-18T23:00:00Z')), 29.1);
  assert.deepEqual(hotDay({ cache: c, now: new Date('2026-11-18T23:00:00Z'), line: 28 }), { hot: true, maxC: 29.1, line: 28, ymd: '2026-11-19' });
  assert.equal(hotDay({ cache: c, now: new Date('2026-11-18T23:00:00Z'), line: 30 }).hot, false);
  assert.equal(hotDay({ cache: c, now: new Date('2026-11-18T03:00:00Z'), line: 28 }).hot, false, '18日は18.4℃');
  assert.equal(hotDay({ cache: c, now: new Date('2026-11-25T03:00:00Z') }).maxC, null, '今日がない（古い）');
  assert.equal(hotDay({ cache: null }).hot, false);
});

test('天気コードの種類と、天気の文', () => {
  assert.equal(weatherGroup(0), 'sunny');
  assert.equal(weatherGroup(2), 'cloudy');
  assert.equal(weatherGroup(45), 'cloudy');
  assert.equal(weatherGroup(63), 'rain');
  assert.equal(weatherGroup(81), 'rain');
  assert.equal(weatherGroup(95), 'rain');
  assert.equal(weatherGroup(73), 'snow');
  assert.equal(weatherGroup(null), null);
  assert.equal(weatherText({ tempC: 9.46, humidity: 62, code: 1 }), '9.5℃・湿度62%・晴れ');
  assert.equal(weatherText({ tempC: 20, humidity: null, code: null }), '20℃');
  assert.equal(weatherText(null), '');
});
