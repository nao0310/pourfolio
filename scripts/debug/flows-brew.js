// 総点検（流れ）：淹れる→評価→提案、日付の区切り、年間まとめのカードを、操作したあとの様子で確かめる。アプリには含めない。
// 使い方：node scripts/debug/flows-brew.js [brew] [dates] [wrapped] [details] [experiments] [bfcache]（省くと全部。SHOTS=フォルダ でまとめのカードの画像を残す）
//   brew    … タイマー（スタート・注湯完了・落ち切った）、途中で閉じて開き直す、隠れて戻る、保存の連打、保存後の「戻る」、評価の保存と直し、提案のボタン
//   dates   … 朝5時の前後・月末・年末年始・開いたまま日をまたぐ（時刻の地域 Asia/Tokyo・UTC・America/Los_Angeles）
//   wrapped … 年間まとめのカードを1枚ずつ（320・375・横向き、demo・nasty・empty・bulk）
//   details … 各画面の <details> を開いてはみ出し・エラーを見る
//   experiments … 条件の飲み比べ（連打・カップで淹れる・保存）と最適化をざっと
//   bfcache … 保存のあと「戻る」でホームが前のまま戻るか（no-store を付けない小さなサーバーで。Playwright は戻る・進むのキャッシュを切っているので再現しない）
// ポートは 8093 だけを使う。結果は標準出力に「NG」「OK」「メモ」の行で出す。
import { createRequire } from 'node:module';
import { startServer, launch, loadFixture, collectErrors } from './pw-lib.js';

const require = createRequire(import.meta.url);
const { devices } = require('playwright');
const PORT = 8093;
const IPHONE = (() => { const d = { ...devices['iPhone 13'] }; delete d.defaultBrowserType; return d; })();

const want = process.argv.slice(2);
const on = (name) => want.length === 0 || want.includes(name);
const log = (kind, ...a) => console.log(`[${kind}]`, ...a);

const srv = await startServer(PORT);
const browser = await launch({ ports: [PORT] });
const base = srv.base;

/** まっさらな iPhone の画面。time を渡すと時計を止めて置く */
async function fresh({ fixture = 'minimal', time = null, timezoneId = 'Asia/Tokyo', viewport = null } = {}) {
  const ctx = await browser.newContext({ ...IPHONE, timezoneId, locale: 'ja-JP', ...(viewport ? { viewport } : {}) });
  if (time) await ctx.clock.install({ time });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(`${base}/more.html`);
  if (fixture) await loadFixture(page, fixture);
  return { ctx, page, errors };
}

const dbq = (page, fn) => page.evaluate(`(async () => { const m = await import('/js/db.js'); const d = m.openDb(); const all = await m.readAll(d); d.close(); const alive = (t) => (all[t] ?? []).filter((r) => r.deletedAt == null); return (${fn})(all, alive); })()`);
/** 画面を閉じて、同じブラウザで別の画面を開く（下書きは localStorage に残る） */
async function reopen(page, errors, path) {
  const ctx = page.context();
  await page.close({ runBeforeUnload: false });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`画面のエラー：${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error：${m.text().slice(0, 200)}`); });
  p.on('dialog', (d) => { errors.push(`標準のダイアログ：${d.message().slice(0, 80)}`); d.dismiss().catch(() => {}); });
  await p.goto(`${base}/${path}`);
  return p;
}
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');

// ---------------- 淹れる → 評価 → 提案 ----------------
async function brewFlow() {
  const T0 = new Date('2026-11-18T09:00:00+09:00');
  let { ctx, page, errors } = await fresh({ fixture: 'minimal', time: T0 });
  const { recipeId, beanId, nBrews, nTx } = await dbq(page, `(all, alive) => ({ recipeId: alive('recipes')[0].id, beanId: alive('beans')[0].id, nBrews: alive('brews').length, nTx: alive('inventoryTx').length })`);
  await page.goto(`${base}/brew.html?recipe=${recipeId}`);
  await page.waitForSelector('#start:visible');
  const plan = await page.evaluate(() => [...document.querySelectorAll('#pourBody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ')));
  log('メモ', '注湯の予定', plan.join(' | '));
  await page.click('#start');
  await page.waitForSelector('#timerView:not([hidden])');
  // スタート直後の2度押し（1.5秒以内）
  await page.clock.runFor(300);
  await page.click('#tap', { force: true });
  await page.clock.runFor(20000);
  await page.click('#tap', { force: true }); // 蒸らしの注湯完了（20秒）
  const lapsA = await page.evaluate(() => JSON.parse(localStorage.getItem('pourfolio.brewDraft')).laps);
  log(lapsA.length === 1 && lapsA[0] >= 20 && lapsA[0] < 21 ? 'OK' : 'NG', 'スタート直後のタップは無視・20秒の注湯完了', JSON.stringify(lapsA));

  // 途中で閉じて開き直す（30秒後）。タイマー中は beforeunload で移れないので、画面を閉じて新しく開く（iPhone でアプリを閉じたのと同じ）
  page = await reopen(page, errors, 'index.html');
  await page.clock.runFor(30000);
  const resumeShown = await page.locator('#resumeCard:visible').count();
  log(resumeShown ? 'OK' : 'NG', 'ホームに「淹れている途中の1杯」');
  await page.goto(`${base}/brew.html`); // タブの「淹れる」から（search なし）
  await page.waitForSelector('#timerView:not([hidden])', { timeout: 5000 }).catch(() => {});
  const el1 = await text(page, '#tElapsed');
  log(el1.startsWith('0:5') ? 'OK' : 'NG', 'search なしで開き直すとタイマーの続き', el1);
  // 同じレシピのURLで開き直す
  page = await reopen(page, errors, `brew.html?recipe=${recipeId}`);
  await page.waitForTimeout(300);
  const timerVis = await page.locator('#timerView:not([hidden])').count();
  log(timerVis ? 'OK' : 'NG', '?recipe= で開き直してもタイマーの続き', await text(page, '#tElapsed'));
  // 別のレシピ（?from=last）で開く → 続きのカード
  page = await reopen(page, errors, `brew.html?from=last`);
  await page.waitForTimeout(500);
  log('メモ', '?from=last で開いたとき：続きのカード', await page.locator('#resumeCard:visible').count(), 'タイマー', await page.locator('#timerView:not([hidden])').count());
  page = await reopen(page, errors, `brew.html?recipe=${recipeId}`);
  await page.waitForSelector('#timerView:not([hidden])');

  // 隠れて戻る（visibilitychange を出して時計を進める）
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(60000);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(200);
  const lapsB = await page.evaluate(() => JSON.parse(localStorage.getItem('pourfolio.brewDraft')).laps);
  log('メモ', '隠れて60秒のあと laps', JSON.stringify(lapsB), '表示', await text(page, '#tElapsed'), await text(page, '#tPhase'));

  // 最後まで進めて、最後の注湯完了 → すぐ落ち切った（2度押し） → 2秒後に落ち切った
  for (let i = 0; i < 20; i++) {
    const ph = await page.locator('#timerView').getAttribute('data-phase');
    if (ph === 'drawdown') break;
    await page.clock.runFor(10000);
    await page.click('#tap', { force: true });
  }
  await page.click('#tap', { force: true }); // 2度押し
  const stillTimer = await page.locator('#timerView:not([hidden])').count();
  log(stillTimer ? 'OK' : 'NG', '最後の注湯完了の直後の2度押しで落ち切りにならない');
  await page.clock.runFor(30000);
  await page.click('#tap', { force: true });
  await page.waitForSelector('#resultView:not([hidden])');
  const total = await page.inputValue('#rTotal');
  log('メモ', '落ち切った：総時間', total);

  // 実績の確認の途中で閉じて開き直す（メモを入れてから）
  await page.fill('#rMemo', '途中のメモ');
  await page.waitForTimeout(200);
  page = await reopen(page, errors, 'index.html');
  await page.goto(`${base}/brew.html`);
  await page.waitForSelector('#resultView:not([hidden])');
  log((await page.inputValue('#rMemo')) === '途中のメモ' ? 'OK' : 'NG', '実績の確認の途中で開き直すとメモが残る');

  // 保存の連打（3回）
  await page.evaluate(() => { const b = document.querySelector('#resultView button[type=submit]'); b.click(); b.click(); b.click(); });
  await page.waitForURL(/tasting\.html/, { timeout: 10000 }).catch(() => {});
  await page.clock.runFor(1000);
  const after = await dbq(page, `(all, alive) => ({ nBrews: alive('brews').length, nTx: alive('inventoryTx').length })`);
  log(after.nBrews === nBrews + 1 && after.nTx === nTx + 1 ? 'OK' : 'NG', '保存の連打で1件だけ', JSON.stringify({ before: { nBrews, nTx }, after }));
  log('メモ', '保存後のURL', page.url().replace(base, ''));
  const brewId = new URL(page.url()).searchParams.get('brew');
  const savedBrew = await dbq(page, `(all) => all.brews.find((b) => b.id === ${JSON.stringify(brewId)})`);
  log('メモ', '保存した杯', JSON.stringify({ at: savedBrew?.at, totalSec: savedBrew?.actual?.totalSec, laps: savedBrew?.actual?.pours?.map((p) => p.doneSec) }));

  // 評価：★と一言を入れて保存、もう一度直す
  await page.waitForSelector('#formView:not([hidden])');
  await page.locator('#stars button').nth(2).click();
  const tag = page.locator('#tags button, #tags .chip').filter({ hasText: /酸っぱい|薄い/ }).first();
  if (await tag.count()) await tag.click();
  await page.evaluate(() => { const b = document.querySelector('#save'); b.click(); b.click(); });
  await page.waitForSelector('#doneView:not([hidden])', { timeout: 5000 }).catch(() => {});
  let t = await dbq(page, `(all, alive) => ({ tastings: alive('tastings').filter((x) => x.brewId === ${JSON.stringify(brewId)}).length, sugg: alive('suggestions').filter((x) => x.brewId === ${JSON.stringify(brewId)}).length })`);
  log(t.tastings === 1 ? 'OK' : 'NG', '評価の2度押しで1件', JSON.stringify(t));
  const sBrew = await page.locator('#sBrew:visible').count() ? await page.getAttribute('#sBrew', 'href') : null;
  log('メモ', '提案', await text(page, '#sAction'), sBrew, 'ボタン', await text(page, '#sBrew'));
  await page.click('#edit');
  await page.locator('#stars button').nth(4).click();
  await page.click('#save');
  await page.waitForSelector('#doneView:not([hidden])', { timeout: 5000 }).catch(() => {});
  t = await dbq(page, `(all, alive) => ({ tastings: alive('tastings').filter((x) => x.brewId === ${JSON.stringify(brewId)}).map((x) => x.overallStars ?? x.stars), sugg: alive('suggestions').filter((x) => x.brewId === ${JSON.stringify(brewId)}).length })`);
  log('メモ', '評価を直したあと', JSON.stringify(t));

  // 保存後の「戻る」
  await page.goBack().catch(() => {});
  await page.waitForTimeout(500);
  log('メモ', '評価の画面から戻る →', page.url().replace(base, ''), 'タイマー', await page.locator('#timerView:not([hidden])').count(), '実績', await page.locator('#resultView:not([hidden])').count());
  await page.goForward().catch(() => {});
  await page.waitForTimeout(300);

  // 提案のボタン
  if (sBrew) {
    await page.goto(`${base}/tasting.html?brew=${brewId}`);
    await page.waitForTimeout(500);
    log('メモ', 'もう一度開いた評価の画面：done', await page.locator('#doneView:not([hidden])').count(), 'form', await page.locator('#formView:not([hidden])').count());
    await page.goto(`${base}/${sBrew}`);
    await page.waitForSelector('#start:visible', { timeout: 5000 }).catch(() => {});
    log('メモ', '提案で淹れる画面', await text(page, '#name'), (await text(page, '#plan')).replace(/\s+/g, ' '), 'エラー', errors.length);
  }
  log(errors.length ? 'NG' : 'OK', '淹れる流れのエラー', errors.join(' / '));
  await ctx.close();
}

// 放っておいた下書き（次の日に開く）と、日をまたいだ杯
async function staleDraft() {
  const T0 = new Date('2026-11-18T23:58:00+09:00');
  let { ctx, page, errors } = await fresh({ fixture: 'minimal', time: T0 });
  const { recipeId } = await dbq(page, `(all, alive) => ({ recipeId: alive('recipes')[0].id })`);
  await page.goto(`${base}/brew.html?recipe=${recipeId}`);
  await page.waitForSelector('#start:visible');
  await page.click('#start');
  await page.clock.runFor(5000);
  page = await reopen(page, errors, 'index.html');
  await page.clock.runFor(10 * 3600 * 1000); // 10時間ほったらかし
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  log('メモ', '10時間後のホームの途中のカード', (await text(page, '#resumeCard')).replace(/\s+/g, ' '));
  await page.goto(`${base}/brew.html`);
  await page.waitForTimeout(500);
  log('メモ', '10時間後に開くと', await text(page, '#tElapsed'), await text(page, '#tPhase'), await text(page, '#tCount'));
  await page.click('#tap', { force: true });
  await page.clock.runFor(2000);
  await page.click('#tap', { force: true });
  await page.waitForTimeout(300);
  log('メモ', '押していくと 実績', await page.locator('#resultView:not([hidden])').count(), '総時間', await page.inputValue('#rTotal').catch(() => ''));
  log(errors.length ? 'NG' : 'OK', '放っておいた下書きのエラー', errors.join(' / '));
  await ctx.close();
}

// 計画の画面の「続きに戻る」から保存して、評価の画面で「戻る」
async function resumeBack() {
  let { ctx, page, errors } = await fresh({ fixture: 'minimal', time: new Date('2026-11-18T09:00:00+09:00') });
  const { recipeId } = await dbq(page, `(all, alive) => ({ recipeId: alive('recipes')[0].id })`);
  await page.goto(`${base}/brew.html?recipe=${recipeId}`);
  await page.waitForSelector('#noTimer:visible');
  await page.click('#noTimer'); // タイマーなし → 実績の確認
  await page.waitForSelector('#resultView:not([hidden])');
  await page.goto(`${base}/index.html`);
  await page.goto(`${base}/brew.html?from=last`);
  await page.waitForSelector('#resume:visible');
  await page.click('#resume');
  await page.waitForSelector('#resultView:not([hidden])');
  await page.fill('#rTotal', '3:10');
  await page.click('#resultView button[type=submit]');
  await page.waitForURL(/tasting/);
  await page.goBack();
  await page.waitForTimeout(800);
  log('メモ', '「続きに戻る」→保存→戻る：', page.url().replace(base, ''), '続きのカード', await page.locator('#resumeCard:visible').count(), '下書き', await page.evaluate(() => localStorage.getItem('pourfolio.brewDraft') != null));
  if (await page.locator('#resume:visible').count()) {
    await page.click('#resume');
    await page.waitForTimeout(800);
    log('メモ', '残ったカードの「続きに戻る」を押すと', page.url().replace(base, ''), (await text(page, '#notFound:not([hidden]) h1')) || '(notFound なし)');
  }
  log(errors.length ? 'NG' : 'OK', '続きに戻る→戻るのエラー', errors.join(' / '));
  await ctx.close();
}

// 戻る・進むのキャッシュ（bfcache）。GitHub Pages は no-store を付けないので、iPhone の Safari では「戻る」で前の画面がそのまま戻る。
// 点検用のサーバーは no-store を付けるので、ここだけ付けない小さなサーバーで試す（同じ 8093 を、点検用のサーバーを止めてから使う）
async function cacheServer() {
  const http = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { ROOT } = await import('./pw-lib.js');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer(async (req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (f.endsWith('/')) f += 'index.html';
    try { const b = await readFile(f); res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' }); res.end(b); } catch { res.writeHead(404).end(); }
  });
  await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));
  return () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); });
}

async function bfcacheBack() {
  await srv.stop();
  const stop = await cacheServer();
  try {
    let { ctx, page, errors } = await fresh({ fixture: 'minimal', time: new Date('2026-11-18T09:00:00+09:00') });
    const { recipeId } = await dbq(page, `(all, alive) => ({ recipeId: alive('recipes')[0].id })`);
    await page.goto(`${base}/brew.html?recipe=${recipeId}`);
    await page.waitForSelector('#noTimer:visible');
    await page.click('#noTimer');
    await page.waitForSelector('#resultView:not([hidden])');
    await page.goto(`${base}/index.html`);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.__mark = 1; });
    log('メモ', 'ホーム：途中のカード', await page.locator('#resumeCard:visible').count());
    await page.click('#resumeLink');
    await page.waitForSelector('#resultView:not([hidden])');
    await page.fill('#rTotal', '3:10');
    await page.click('#resultView button[type=submit]');
    await page.waitForURL(/tasting/);
    await page.waitForSelector('#formView:not([hidden])');
    await page.goBack();
    await page.waitForTimeout(800);
    const restored = await page.evaluate(() => window.__mark === 1);
    log('メモ', 'bfcache に入らなかった理由（Chromium）', JSON.stringify(await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.notRestoredReasons ?? null)));
    log(restored && (await page.locator('#resumeCard:visible').count()) ? 'NG' : 'メモ', '保存→評価の画面で「戻る」→ホーム：bfcache から戻った', restored, '途中のカード', await page.locator('#resumeCard:visible').count(), '下書き', await page.evaluate(() => localStorage.getItem('pourfolio.brewDraft') != null), '直近の記録', (await text(page, '#recent')).slice(0, 80).replace(/\s+/g, ' '));
    log(errors.length ? 'NG' : 'OK', 'bfcache のエラー', errors.join(' / '));
    await ctx.close();
  } finally {
    await stop();
  }
}

// ---------------- 日付の区切り ----------------
/** minimal の杯を写して、指定の時刻（ISO）の杯を足す。元の杯は消す */
async function putBrews(page, isoList) {
  return page.evaluate(async (list) => {
    const m = await import('/js/db.js');
    const d = m.openDb();
    const src = (await d.table('brews').toArray())[0];
    await d.table('brews').delete(src.id);
    await d.table('tastings').clear();
    for (const at of list) await d.table('brews').put({ ...src, id: crypto.randomUUID(), at, createdAt: at, updatedAt: at });
    d.close();
  }, isoList);
}

/** 各画面の「今日・今月・今年」の数字 */
async function readScreens(page, { year, month }) {
  const out = {};
  const go = async (path) => { await page.goto(`${base}/${path}`); await page.waitForTimeout(700); };
  await go('index.html');
  out.homeCaf = (await page.locator('#cafCard:visible').count()) ? await text(page, '#cafMain') : '(カフェインのカードなし)';
  out.homeWrapped = (await page.locator('#wrappedCard:visible').count()) ? `${await text(page, '#wrappedTitle')} → ${await page.getAttribute('#wrappedLink', 'href')}` : '';
  await go('today.html');
  out.today = await text(page, '#cafToday');
  await go('analysis.html');
  out.analysisToday = await page.evaluate(() => { const dt = [...document.querySelectorAll('dt')].find((x) => x.textContent === '今日'); return dt?.nextElementSibling?.textContent ?? ''; });
  await go('calendar.html');
  out.calMonth = await text(page, '#month strong');
  out.calTodayCell = await page.evaluate(() => { const c = document.querySelector('td.today'); return c ? `${c.querySelector('.cal-date')?.textContent}日 ${c.querySelector('.cal-cups')?.textContent ?? '0杯'}` : '(今日のマスなし)'; });
  out.calCafToday = await page.evaluate(() => { const dt = [...document.querySelectorAll('#caffeine dt')].find((x) => x.textContent === '今日'); return dt?.nextElementSibling?.textContent ?? ''; });
  await go('report.html');
  out.report = `${await page.inputValue('#month').catch(() => '')} ${(await page.locator('.rp-stat').first().innerText().catch(() => '')).replace(/\s+/g, ' ')}`;
  await go('wrapped.html');
  out.wrapped = `${await page.inputValue('#year').catch(() => '')} ${(await text(page, '.wr-slide, .wr-card, #slides')).replace(/\s+/g, ' ').slice(0, 60)}`;
  return out;
}

async function dateBoundaries() {
  // 杯（日本時間）：11/30 22:00、12/1 01:00、12/1 04:30、12/31 23:30、1/1 02:00
  const brews = ['2026-11-30T13:00:00Z', '2026-11-30T16:00:00Z', '2026-11-30T19:30:00Z', '2026-12-31T14:30:00Z', '2026-12-31T17:00:00Z'];
  const cases = [
    { tz: 'Asia/Tokyo', now: '2026-12-01T04:59:00+09:00' },
    { tz: 'Asia/Tokyo', now: '2026-12-01T05:00:00+09:00' },
    { tz: 'Asia/Tokyo', now: '2027-01-01T03:00:00+09:00' },
    { tz: 'Asia/Tokyo', now: '2027-01-01T05:30:00+09:00' },
    { tz: 'UTC', now: '2026-12-01T04:59:00Z' },
    { tz: 'America/Los_Angeles', now: '2026-12-01T04:59:00-08:00' },
  ];
  for (const c of cases) {
    const { ctx, page, errors } = await fresh({ fixture: 'minimal', time: new Date(c.now), timezoneId: c.tz });
    await putBrews(page, brews.filter((b) => new Date(b) <= new Date(c.now))); // 未来の杯は入れない
    const r = await readScreens(page, {});
    log('メモ', `${c.tz} ${c.now}`, JSON.stringify(r, null, 0));
    if (errors.length) log('NG', 'エラー', errors.join(' / '));
    await ctx.close();
  }
}

/** 画面を開いたまま朝5時・0時をまたぐ */
async function openAcross() {
  const brews = ['2026-11-30T13:00:00Z', '2026-11-30T16:00:00Z'];
  for (const [path, t0, adv] of [['index.html', '2026-12-01T04:58:00+09:00', 3], ['today.html', '2026-12-01T04:58:00+09:00', 3], ['analysis.html', '2026-12-01T04:58:00+09:00', 3], ['calendar.html', '2026-11-30T23:58:00+09:00', 3], ['wrapped.html', '2026-12-31T23:58:00+09:00', 3], ['tasting.html', null, 0]]) {
    if (!t0) continue;
    const { ctx, page, errors } = await fresh({ fixture: 'minimal', time: new Date(t0) });
    await putBrews(page, brews.filter((b) => new Date(b) <= new Date(t0)));
    await page.goto(`${base}/${path}`);
    await page.waitForTimeout(700);
    const read = () => page.evaluate(() => [document.querySelector('#cafMain')?.textContent, document.querySelector('#cafSub')?.textContent, document.querySelector('#cafToday')?.textContent, document.querySelector('td.today .cal-date')?.textContent && `今日のマス ${document.querySelector('td.today .cal-date').textContent}日`, document.querySelector('#month strong')?.textContent, document.querySelector('#todayText')?.textContent, [...document.querySelectorAll('dt')].find((x) => x.textContent === '今日')?.nextElementSibling?.textContent, document.querySelector('#year')?.value, document.querySelector('.wr-slide')?.textContent?.slice(0, 40)].filter(Boolean).join(' / '));
    const before = await read();
    await page.clock.runFor(adv * 60 * 1000); // 区切りの時刻を過ぎる
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await page.waitForTimeout(500);
    const after = await read();
    await page.reload();
    await page.waitForTimeout(700);
    const reloaded = await read();
    log(after === reloaded ? 'OK' : 'NG', `${path} 開いたまま ${t0.slice(11, 16)}→${adv}分後（戻ってきた合図のあと）`, `前：${before}`, `｜合図のあと：${after}`, `｜開き直すと：${reloaded}`);
    if (errors.length) log('NG', 'エラー', errors.join(' / '));
    await ctx.close();
  }
}

// ---------------- 年間まとめ ----------------
const SHOTS = process.env.SHOTS || null; // 画像を残すフォルダ（省くと残さない）

/** 今のカードの様子：何枚目か・数の表示・カードの中のはみ出し */
const slideState = (page) => page.evaluate(() => {
  const deck = document.querySelector('#deck');
  const i = Math.round(deck.scrollLeft / Math.max(1, deck.clientWidth));
  const s = deck.children[i];
  const r = s.getBoundingClientRect();
  const wide = [...s.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right - 2 || b.left < r.left + 2); }).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`);
  const nav = document.querySelector('.wr-nav').getBoundingClientRect();
  const tab = document.querySelector('.tabbar, nav.tabs, nav[aria-label]')?.getBoundingClientRect();
  return {
    i, n: deck.children.length, key: [...s.classList].find((c) => c.startsWith('wr-s-')),
    count: document.querySelector('#count').textContent,
    hScroll: s.scrollWidth > s.clientWidth + 1 ? `${s.scrollWidth}>${s.clientWidth}` : '',
    vScroll: s.scrollHeight > s.clientHeight + 1 ? `${s.scrollHeight}>${s.clientHeight}` : '',
    wide: [...new Set(wide)].slice(0, 4).join(','),
    navVisible: nav.bottom <= innerHeight && (!tab || nav.bottom <= tab.top + 1),
    docW: document.documentElement.scrollWidth, vw: innerWidth,
    text: s.innerText.replace(/\s+/g, ' ').slice(0, 50),
    bad: /undefined|NaN|null|Infinity|\[object/.test(s.innerText) ? s.innerText.match(/.{0,20}(undefined|NaN|null|Infinity|\[object).{0,20}/)?.[0] : '',
  };
});

async function wrappedCards() {
  const sizes = [{ name: '320', w: 320, h: 640 }, { name: '375', w: 375, h: 812 }, { name: '横', w: 844, h: 390 }];
  for (const fixture of ['demo', 'nasty', 'empty', 'bulk']) {
    for (const vp of sizes) {
      const { ctx, page, errors } = await fresh({ fixture, viewport: { width: vp.w, height: vp.h }, time: new Date('2026-11-18T12:00:00+09:00') });
      for (const year of fixture === 'nasty' || fixture === 'bulk' ? ['2026', '2025'] : ['2026']) {
        await page.goto(`${base}/wrapped.html?year=${year}`);
        await page.waitForSelector('#count:not(:empty)');
        await page.waitForTimeout(300);
        const seen = [];
        for (let k = 0; k < 20; k++) {
          const st = await slideState(page);
          const probs = [st.count !== `${st.i + 1} / ${st.n}` && `数の表示が「${st.count}」`, st.hScroll && `カードの中で横にはみ出し ${st.hScroll}（${st.wide}）`, st.docW > st.vw + 1 && `画面が横にはみ出し ${st.docW}`, !st.navVisible && '「前へ」「次へ」が画面の外か下のタブの下', st.bad && `表示に「${st.bad}」`].filter(Boolean);
          seen.push(st.key);
          if (probs.length) log('NG', `まとめ ${fixture} ${year} ${vp.name} ${st.i + 1}枚目 ${st.key}`, probs.join('／'), st.vScroll ? `（縦は中でスクロール ${st.vScroll}）` : '');
          if (SHOTS) await page.screenshot({ path: `${SHOTS}/wr-${fixture}-${year}-${vp.name}-${st.i + 1}.png` });
          if (st.i >= st.n - 1) break;
          // 次へ：ボタン・矢印キー・カードの右側を順に使う
          if (k % 3 === 0) await page.click('#nextBtn');
          else if (k % 3 === 1) { await page.focus('#deck'); await page.keyboard.press('ArrowRight'); }
          else { const b = await page.locator('#deck').boundingBox(); await page.mouse.click(b.x + b.width - 20, b.y + 30); }
          await page.waitForTimeout(700);
          const st2 = await slideState(page);
          if (st2.i !== st.i + 1) log('NG', `まとめ ${fixture} ${year} ${vp.name} ${st.i + 1}枚目から次へ進まない（${k % 3 === 0 ? 'ボタン' : k % 3 === 1 ? '矢印キー' : 'カードの右側'}）`, `→ ${st2.i + 1}枚目`);
        }
        log('メモ', `まとめ ${fixture} ${year} ${vp.name}`, seen.join(' '));
        // 戻る：「前へ」を最後から最初まで
        for (let k = 0; k < 20; k++) { const st = await slideState(page); if (st.i === 0) break; await page.click('#prevBtn'); await page.waitForTimeout(600); }
        const back = await slideState(page);
        if (back.i !== 0 || back.count !== `1 / ${back.n}`) log('NG', `まとめ ${fixture} ${year} ${vp.name} 前へで最初に戻れない`, JSON.stringify(back));
      }
      if (errors.length) log('NG', `まとめ ${fixture} ${vp.name} のエラー`, errors.join(' / '));
      await ctx.close();
    }
  }
  // 途中のカードで画面を回す（縦→横→縦）
  const { ctx, page, errors } = await fresh({ fixture: 'demo', viewport: { width: 390, height: 844 }, time: new Date('2026-11-18T12:00:00+09:00') });
  await page.goto(`${base}/wrapped.html?year=2026`);
  await page.waitForSelector('#count:not(:empty)');
  for (let k = 0; k < 4; k++) { await page.click('#nextBtn'); await page.waitForTimeout(600); }
  const a = await slideState(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(800);
  const b = await slideState(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const c = await slideState(page);
  log(a.i === b.i && b.i === c.i && c.count === a.count ? 'OK' : 'NG', 'まとめ 途中で画面を回す', `${a.i + 1}枚目（${a.count}）→ 横 ${b.i + 1}枚目（${b.count}）→ 縦 ${c.i + 1}枚目（${c.count}）`);
  // 年を変える → 1枚目に戻るか
  const opts = await page.locator('#year option').allTextContents();
  if (opts.length > 1) { await page.selectOption('#year', { index: 1 }); await page.waitForTimeout(500); const d = await slideState(page); log(d.i === 0 && d.count.startsWith('1 /') ? 'OK' : 'NG', 'まとめ 年を変えると1枚目から', d.count); }
  // 画像にする
  for (let k = 0; k < 20; k++) { const st = await slideState(page); if (st.i >= st.n - 1) break; await page.click('#nextBtn'); await page.waitForTimeout(500); }
  if (await page.locator('#imageMake').count()) {
    await page.click('#imageMake');
    await page.waitForTimeout(1500);
    log((await page.locator('#imagePreview:visible').count()) ? 'OK' : 'NG', 'まとめ 画像にする', await text(page, '#imageMsg'));
  }
  if (errors.length) log('NG', 'まとめ 回す・年を変えるのエラー', errors.join(' / '));
  await ctx.close();
}

// ---------------- 開いて見る部分（<details>） ----------------
async function detailsAll() {
  for (const fixture of ['demo', 'nasty']) {
    for (const w of [320, 375]) {
      const { ctx, page, errors } = await fresh({ fixture, viewport: { width: w, height: 700 }, time: new Date('2026-11-18T12:00:00+09:00') });
      const pages = await page.evaluate(async () => (await import('/scripts/debug/audit.js')).pagesWithIds({ every: true }));
      for (const path of pages) {
        if (/scan\.html|storage-test/.test(path)) continue;
        await page.goto(`${base}/${path}`);
        await page.waitForTimeout(600);
        const n = await page.locator('details').count();
        if (!n) continue;
        const before = errors.length;
        // 閉じている <details> を全部開く（中にさらにあれば、それも）
        for (let round = 0; round < 3; round++) {
          const closed = page.locator('details:not([open]) > summary:visible');
          const c = await closed.count();
          if (!c) break;
          for (let i = 0; i < c; i++) await closed.first().click().catch(() => {});
          await page.waitForTimeout(200);
        }
        const res = await page.evaluate(async (vw) => (await import('/scripts/debug/audit.js')).inspect(window, { w: vw, h: 700 }), w);
        const probs = ['overflowX', 'clipped', 'smallTap', 'smallText', 'lowContrast', 'loading', 'badText', 'badValue'].filter((k) => res[k]).map((k) => `${k}: ${JSON.stringify(res[k]).slice(0, 200)}`);
        // 開いた中身がカードからはみ出していないか
        const spill = await page.evaluate(() => [...document.querySelectorAll('details[open]')].flatMap((d) => { const r = d.getBoundingClientRect(); return [...d.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > r.right + 1; }).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')}`); }).slice(0, 5));
        if (spill.length) probs.push(`開いた中身が外へ：${spill.join(',')}`);
        if (errors.length > before) probs.push(`エラー：${errors.slice(before).join(' / ')}`);
        log(probs.length ? 'NG' : 'OK', `開く部分 ${fixture} ${w} ${path}（${n}個）`, probs.join('｜'));
      }
      await ctx.close();
    }
  }
}

// ---------------- 実験（飲み比べ・最適化）をざっと ----------------
async function experiments() {
  const { ctx, page, errors } = await fresh({ fixture: 'demo', time: new Date('2026-11-18T12:00:00+09:00') });
  const n0 = await dbq(page, `(all, alive) => alive('experiments').length`);
  await page.goto(`${base}/compare.html`);
  await page.waitForSelector('#kindSeg button');
  await page.locator('#kindSeg button', { hasText: '条件' }).click();
  await page.waitForSelector('#varForm:not([hidden])');
  await page.evaluate(() => { const b = document.querySelector('#vStart'); b.click(); b.click(); b.click(); });
  await page.waitForURL(/compare\.html\?id=/, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  const n1 = await dbq(page, `(all, alive) => alive('experiments').length`);
  log(n1 === n0 + 1 ? 'OK' : 'NG', '条件の飲み比べ 連打で1件', `${n0}→${n1}`, await text(page, '#vMsg'));
  const cupLinks = await page.locator('a[href*="brew.html"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  log('メモ', '飲み比べのカップのリンク', cupLinks.join(' '));
  if (cupLinks[0]) {
    await page.goto(`${base}/${cupLinks[0]}`);
    await page.waitForSelector('#noTimer:visible');
    log('メモ', '飲み比べで淹れる画面', await text(page, '#compareTitle'), await text(page, '#compareCup'), '提案のカード', await page.locator('#suggestCard:visible').count());
    await page.click('#noTimer');
    await page.waitForSelector('#resultView:not([hidden])');
    await page.fill('#rTotal', '3:00');
    await page.evaluate(() => { const b = document.querySelector('#resultView button[type=submit]'); b.click(); b.click(); });
    await page.waitForURL(/compare\.html/, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    const ex = await dbq(page, `(all, alive) => { const e = alive('experiments').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; return { brews: (e.entries ?? []).map((x) => x.brewId ?? null) }; }`);
    log('メモ', '保存後', page.url().replace(base, ''), JSON.stringify(ex));
    await page.goBack();
    await page.waitForTimeout(800);
    log('メモ', '飲み比べに戻ったあと「戻る」→', page.url().replace(base, ''));
  }
  // 最適化
  await page.goto(`${base}/optimize.html`);
  await page.waitForTimeout(800);
  if (await page.locator('#startView:not([hidden])').count()) {
    await page.evaluate(() => { const b = document.querySelector('#start'); b.click(); b.click(); });
    await page.waitForURL(/optimize\.html\?id=/, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
    log('メモ', '最適化を始めた', page.url().replace(base, ''), await text(page, '#msg'), (await text(page, '#nextText')).slice(0, 80));
    const href = await page.getAttribute('#nextBrew', 'href').catch(() => null);
    if (href) { await page.goto(`${base}/${href}`); await page.waitForTimeout(800); log('メモ', '最適化の「この条件で淹れる」', (await text(page, '#plan')).replace(/\s+/g, ' '), await text(page, '#compareTitle')); }
  }
  const nOpt = await dbq(page, `(all, alive) => alive('experiments').filter((e) => e.kind === 'optimize').length`);
  log('メモ', '最適化の件数', nOpt);
  log(errors.length ? 'NG' : 'OK', '実験のエラー', errors.join(' / '));
  await ctx.close();
}

const run = async (name, fn) => { try { await fn(); } catch (e) { log('NG', `${name} が途中で止まった`, e.message.split('\n')[0]); } };
if (on('brew')) { await run('brewFlow', brewFlow); await run('staleDraft', staleDraft); await run('resumeBack', resumeBack); }
if (on('dates')) { await run('dateBoundaries', dateBoundaries); await run('openAcross', openAcross); }
if (on('wrapped')) await run('wrappedCards', wrappedCards);
if (on('details')) await run('detailsAll', detailsAll);
if (on('experiments')) await run('experiments', experiments);
if (on('bfcache')) await run('bfcacheBack', bfcacheBack);

await browser.close();
await srv.stop().catch(() => {});
