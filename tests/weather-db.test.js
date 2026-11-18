// 天気をあとから杯に入れる（X16）とデータベース（fake-indexeddb、テスト専用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openDb, addRecipe, saveBrew, getBrew, setBrewWeather, exportAll, clearAll, restoreBackup } from '../js/db.js';
import { normalizeRecipeInput, newRecipeState, planFromRecipe } from '../js/core/recipes.js';
import { newDraft, finishDraft, initialActualInput, normalizeActualInput, buildBrew } from '../js/core/brews.js';
import { parseBackup } from '../js/core/backup.js';
import { markDeleted } from '../js/core/records.js';
import { fillTargets, parseWeather, placeByKey } from '../js/core/weather.js';

const NOW = new Date('2026-11-18T07:42:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60000);
const freshDb = () => openDb('pourfolio-test', { indexedDB: new IDBFactory(), IDBKeyRange });

async function brewOf(db, at, plan = {}) {
  const recipe = await addRecipe(db, normalizeRecipeInput({ ...newRecipeState(), name: '4:6' }).value, NOW);
  const start = at.getTime();
  const draft = finishDraft({ ...newDraft({ ...planFromRecipe(recipe), ...plan }, null, start), laps: [9, 50, 94, 139, 183] }, start + 215_000);
  const { value } = normalizeActualInput(initialActualInput(draft));
  return (await saveBrew(db, buildBrew({ draft, value, at: at.toISOString() }), at)).brew;
}

function cacheAround(at) {
  const t0 = Math.floor(at.getTime() / 3600000) * 3600 - 3600 * 5;
  const time = Array.from({ length: 24 }, (_, i) => t0 + i * 3600);
  return parseWeather({ utc_offset_seconds: 32400, hourly: { time, temperature_2m: time.map(() => 12.3), relative_humidity_2m: time.map(() => 61), weather_code: time.map(() => 3) } }, placeByKey('tokyo'));
}

test('天気を入れると context.weather だけが増え、updatedAt が進む。ほかの項目はそのまま', async () => {
  const db = freshDb();
  const brew = await brewOf(db, NOW, { adjust: { mood: 'wake', cups: 2 } });
  const before = await getBrew(db, brew.id);
  const targets = fillTargets([before], cacheAround(NOW), later(60));
  assert.equal(targets.length, 1);
  assert.equal(await setBrewWeather(db, targets, later(60)), 1);
  const after = await getBrew(db, brew.id);
  assert.deepEqual(after.context, { ...before.context, weather: { tempC: 12.3, humidity: 61, code: 3 } });
  assert.equal(after.updatedAt, later(60).toISOString());
  const { context: _a, updatedAt: _b, ...restAfter } = after;
  const { context: _c, updatedAt: _d, ...restBefore } = before;
  assert.deepEqual(restAfter, restBefore);
  // 2回目は何もしない（すでに天気がある）
  assert.equal(await setBrewWeather(db, targets, later(90)), 0);
  assert.equal((await getBrew(db, brew.id)).updatedAt, later(60).toISOString());
});

test('削除した杯・ない杯には入れない。空の一覧では何もしない', async () => {
  const db = freshDb();
  const brew = await brewOf(db, NOW);
  await db.table('brews').put(markDeleted(await getBrew(db, brew.id), later(1)));
  assert.equal(await setBrewWeather(db, [{ id: brew.id, weather: { tempC: 1, humidity: 1, code: 0 } }, { id: 'nope', weather: { tempC: 1 } }], later(2)), 0);
  assert.equal(await setBrewWeather(db, [], later(2)), 0);
});

test('天気の付いた杯も、天気のない古いバックアップも、そのまま復元できる', async () => {
  const db = freshDb();
  const brew = await brewOf(db, NOW);
  await setBrewWeather(db, fillTargets([await getBrew(db, brew.id)], cacheAround(NOW), later(60)), later(60));
  const backup = await exportAll(db, later(61));
  await clearAll(db);
  await restoreBackup(db, parseBackup(JSON.stringify(backup)));
  assert.deepEqual((await getBrew(db, brew.id)).context.weather, { tempC: 12.3, humidity: 61, code: 3 });

  // 3-2までのバックアップ（杯に天気がない）
  const db2 = freshDb();
  const old = await brewOf(db2, NOW);
  const oldBackup = await exportAll(db2, later(1));
  const db3 = freshDb();
  await restoreBackup(db3, parseBackup(JSON.stringify(oldBackup)));
  const restored = await getBrew(db3, old.id);
  assert.equal(restored.context.weather, undefined);
  assert.equal(fillTargets([restored], cacheAround(NOW), later(60)).length, 1, 'あとから天気を入れられる');
});
