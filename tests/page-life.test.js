// 画面に戻ってきたときの読み直し（総仕上げの54・59番）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shouldReload, dayKey, pageName, DAY_PAGES } from '../js/core/page-life.js';

const at = (s) => new Date(s);

test('「戻る」で前の画面がそのまま出たら（persisted）読み直す。ふつうに開いたときは読み直さない', () => {
  const base = { event: 'pageshow', pathname: '/pourfolio/beans.html', loadedKey: dayKey(at('2026-11-18T10:00:00')), now: at('2026-11-18T10:01:00') };
  assert.equal(shouldReload({ ...base, persisted: true }), true);
  assert.equal(shouldReload({ ...base, persisted: false }), false);
  assert.equal(shouldReload({ ...base, persisted: true, blocked: true }), false);
});

test('開いたまま朝5時を越えて戻ったら、日付で数える画面だけ読み直す', () => {
  const loadedKey = dayKey(at('2026-12-01T04:58:00'));
  const now = at('2026-12-01T05:01:00');
  assert.equal(shouldReload({ event: 'visible', pathname: '/', loadedKey, now }), true);
  assert.equal(shouldReload({ event: 'visible', pathname: '/today.html', loadedKey, now }), true);
  assert.equal(shouldReload({ event: 'visible', pathname: '/beans.html', loadedKey, now }), false);
  // 同じ日のうち（4:58 → 4:59）は読み直さない
  assert.equal(shouldReload({ event: 'visible', pathname: '/', loadedKey, now: at('2026-12-01T04:59:30') }), false);
  assert.equal(shouldReload({ event: 'visible', pathname: '/', loadedKey, now, blocked: true }), false);
});

test('0時を越えたら（カレンダー・年間まとめ）読み直す。年越しも', () => {
  const loadedKey = dayKey(at('2026-12-31T23:58:00'));
  const now = at('2027-01-01T00:01:00');
  assert.equal(shouldReload({ event: 'visible', pathname: '/calendar.html', loadedKey, now }), true);
  assert.equal(shouldReload({ event: 'visible', pathname: '/wrapped.html', loadedKey, now }), true);
});

test('画面の名前', () => {
  assert.equal(pageName('/pourfolio/'), 'index.html');
  assert.equal(pageName('/pourfolio/calendar.html'), 'calendar.html');
  for (const p of DAY_PAGES) assert.match(p, /\.html$/);
});

test('全画面で呼ぶ registerServiceWorker が読み直しの見張りを始める', async () => {
  const pwa = await readFile(new URL('../js/pwa.js', import.meta.url), 'utf8');
  assert.match(pwa, /export async function registerServiceWorker\(\) \{\n {2}watchPageLife\(\);/);
});

test('全画面で、記録の保存場所が使えないかを確かめる（総仕上げの74番）', async () => {
  const pwa = await readFile(new URL('../js/pwa.js', import.meta.url), 'utf8');
  assert.match(pwa, /checkStorage\(\);/);
  const sc = await readFile(new URL('../js/storage-check.js', import.meta.url), 'utf8');
  assert.match(sc, /pourfolio-probe/); // 記録の保存場所（pourfolio）には触らない
  assert.match(sc, /deleteDatabase\('pourfolio-probe'\)/);
});

test('豆の画面：飲み切りは2度押しを受け付けない。読み込みの失敗は見える所に出す（56・65番）', async () => {
  const s = await readFile(new URL('../js/bean-page.js', import.meta.url), 'utf8');
  assert.match(s, /const toggleFinished = singleFlight\(/);
  assert.match(s, /render\(\)\.catch\(\(err\) => \{\n {2}console\.error\(err\);\n {2}showPageLoadError\(err\);/);
  assert.match(s, /!\(t\.kind === 'brew' && t\.brewId\)/);
});
