// 天気の問い合わせ（js/weather-sync.js）：Safari で事前の確認（CORSのプリフライト）が起きない形で送る
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWeather } from '../js/weather-sync.js';
import { placeByKey } from '../js/core/weather.js';

const TOKYO = placeByKey('tokyo');

function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = orig;
  });
}

test('問い合わせは GET だけで、cache の指定やヘッダーを付けない（Safari で Cache-Control・Pragma が足されて通らなくなるため）', async () => {
  const calls = [];
  await withFetch(
    async (url, opts = {}) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ utc_offset_seconds: 32400, hourly: { time: [0, 3600], temperature_2m: [1, 2] }, daily: {} }) };
    },
    async () => {
      const r = await fetchWeather(TOKYO, { force: true });
      assert.equal(r.error, null);
      assert.ok(r.cache);
    },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.deepEqual(Object.keys(calls[0].opts), ['signal'], 'signal（時間切れ用）のほかは何も付けない');
});

test('通信で失敗したときは、ブラウザの言葉をかっこに入れて返す（原因を確かめられるように）', async () => {
  await withFetch(
    async () => {
      throw new TypeError('Load failed');
    },
    async () => {
      const r = await fetchWeather(TOKYO, { force: true });
      assert.equal(r.error, '天気を受け取れませんでした（通信を確かめてください：Load failed）');
    },
  );
  await withFetch(
    async () => ({ ok: false, status: 429, json: async () => ({}) }),
    async () => {
      assert.equal((await fetchWeather(TOKYO, { force: true })).error, '天気を受け取れませんでした（429）');
    },
  );
});
