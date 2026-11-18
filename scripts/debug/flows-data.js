// 総仕上げ（3-6 のあと）：データ・保存・オフライン・更新の「操作のあと」の流れを Playwright で確かめる。アプリには含めない。
// 使い方：node scripts/debug/flows-data.js [区分…]   区分：data storage weather autosave offline sw（省くと全部）
//   sw は古い版のフォルダが要る：OLD_ROOT=<古い版のフォルダ> node scripts/debug/flows-data.js sw
//   （例：git worktree add <一時フォルダ>/old-main origin/main~3。終わったら git worktree remove --force）
// ポートは 8094 だけを使う。天気（api.open-meteo.com）は Playwright の route で返し、本物には問い合わせない。
// 結果は標準出力に「[区分] 何を → 結果」の形で出す。アプリのファイルは何も変えない。
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, launch, loadFixture, ROOT, chromium } from './pw-lib.js';

/** 画面のエラーを集める（pw-lib の collectErrors と同じ。ただし「このページを離れますか」は離れる側を押す） */
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`画面のエラー：${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error：${m.text().slice(0, 200)}`); });
  page.on('dialog', (d) => {
    if (d.type() === 'beforeunload') { errors.beforeunload = (errors.beforeunload ?? 0) + 1; return d.accept().catch(() => {}); }
    errors.push(`標準のダイアログ：${d.message().slice(0, 80)}`); d.dismiss().catch(() => {});
  });
  return errors;
}

const PORT = 8094;
const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const on = (k) => want.length === 0 || want.includes(k);
const log = (sec, ...a) => console.log(`[${sec}]`, ...a);

const srv = await startServer(PORT);
const browser = await launch({ ports: [PORT] });
const tmp = await mkdtemp(path.join(tmpdir(), 'pf-flows-'));

/** 保存場所の中身（全部の表、削除の印のものも） */
const dump = (page) => page.evaluate(async () => {
  const { openDb, readAll } = await import('/js/db.js');
  const db = openDb();
  const all = await readAll(db);
  db.close();
  return all;
});
const counts = (all) => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.length]));
/** 画面の確認の箱で「はい」側を押す */
async function confirmYes(page) {
  const box = page.locator('dialog.confirm-box');
  await box.waitFor({ timeout: 5000 });
  await box.locator('button:not(.secondary)').click();
}
const msg = (page) => page.locator('#msg').textContent();

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  return { ctx, page, errors };
}

// ---------------------------------------------------------------- 1. 書き出し → 全部消す → 復元
if (on('data')) {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${srv.base}/data.html`);
  await loadFixture(page, 'nasty');
  // 端末だけの設定（最後に見た版）を入れておく
  await page.evaluate(async () => {
    const { openDb, setDeviceSettings } = await import('/js/db.js');
    const db = openDb();
    await setDeviceSettings(db, { lastSeenVersion: '9.9' });
    db.close();
  });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#counts')?.textContent.includes('読み込み中'));
  const before = await dump(page);

  // 書き出す（2度押し）
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  // 人の2度押しに近づけて、間をあけずに2回押す（page.click は押せるようになるまで待つので、2回目が遅れて新しい書き出しになる）
  await page.evaluate(() => {
    const b = document.getElementById('export');
    b.click();
    b.click();
  });
  await page.waitForTimeout(1500);
  log('data', `書き出すの2度押し → ダウンロード ${downloads.length} 件、知らせ「${await msg(page)}」`);
  const file = path.join(tmp, 'backup.json');
  await downloads[0].saveAs(file);
  const exported = JSON.parse(await readFile(file, 'utf8'));
  log('data', `書き出した設定の lastBackupAt=${exported.tables.settings[0]?.lastBackupAt} lastSeenVersion=${exported.tables.settings[0]?.lastSeenVersion}`);
  const afterExport = await dump(page);
  log('data', `書き出したあとの設定の lastBackupAt=${afterExport.settings[0]?.lastBackupAt}`);

  // 全部消す
  await page.click('#clear');
  await confirmYes(page);
  await confirmYes(page);
  await page.waitForFunction(() => document.querySelector('#msg')?.textContent.includes('消しました'));
  log('data', `全部消す → ${JSON.stringify(counts(await dump(page)))}`);

  // ホームを開いてから戻る（新しい端末と同じく設定が自動で作られる）
  await page.goto(`${srv.base}/index.html`);
  await page.waitForTimeout(1500);
  await page.goto(`${srv.base}/data.html`);
  await page.waitForFunction(() => !document.querySelector('#counts')?.textContent.includes('読み込み中'));

  // 復元（2回）
  for (const n of [1, 2]) {
    await page.evaluate(() => { document.querySelector('#msg').textContent = ''; });
    await page.setInputFiles('#file', file);
    await confirmYes(page);
    await page.waitForFunction(() => /復元しました|できません/.test(document.querySelector('#msg')?.textContent ?? ''));
    log('data', `復元${n}回目 → 「${await msg(page)}」`);
  }
  const after = await dump(page);
  const diff = [];
  for (const k of Object.keys(before)) {
    const a = JSON.stringify([...before[k]].sort((x, y) => x.id.localeCompare(y.id)));
    const b = JSON.stringify([...after[k]].sort((x, y) => x.id.localeCompare(y.id)));
    if (a !== b) diff.push(k);
  }
  log('data', `往復の前後で違う表：${diff.join('、') || 'なし'}`);
  if (diff.includes('settings')) log('data', `  前 ${JSON.stringify(before.settings)}\n  後 ${JSON.stringify(after.settings)}`);
  log('data', `画面の「最後に書き出した日時」：${await page.locator('#lastBackup').textContent()}`);

  // 古い版のファイル（表が足りない・版5より前の形）
  const old = structuredClone(exported);
  for (const t of ['photos', 'experiments', 'wishlist', 'frozenPortions', 'orders', 'suggestions']) delete old.tables[t];
  const oldFile = path.join(tmp, 'old.json');
  await writeFile(oldFile, JSON.stringify(old));
  await page.click('#clear'); await confirmYes(page); await confirmYes(page);
  await page.waitForFunction(() => document.querySelector('#msg')?.textContent.includes('消しました'));
  await page.setInputFiles('#file', oldFile);
  await confirmYes(page);
  await page.waitForFunction(() => /復元しました|でき/.test(document.querySelector('#msg')?.textContent ?? ''));
  log('data', `古い形（表が足りない）の復元 → 「${await msg(page)}」 ${JSON.stringify(counts(await dump(page)))}`);

  // 壊れた・空・違うファイル
  const cases = {
    'broken.json': '{"app":"pourfolio","formatVersion":1,"tables":{"beans":[{"id":"x"',
    'empty.json': '',
    'other.json': '{"hello":1}',
    'newer.json': JSON.stringify({ ...exported, formatVersion: 99 }),
    'noid.json': JSON.stringify({ ...exported, tables: { beans: [{ name: 'a' }] } }),
    'nullrow.json': JSON.stringify({ ...exported, tables: { beans: [null] } }),
    'tablesnull.json': JSON.stringify({ ...exported, tables: null }),
    'image.png': '\x89PNG\r\n',
  };
  for (const [name, body] of Object.entries(cases)) {
    const f = path.join(tmp, name);
    await writeFile(f, body, name.endsWith('.png') ? 'latin1' : 'utf8');
    await page.evaluate(() => { document.querySelector('#msg').textContent = ''; });
    await page.setInputFiles('#file', f);
    await page.waitForTimeout(500);
    const dlg = await page.locator('dialog.confirm-box').count();
    if (dlg) await page.locator('dialog.confirm-box button.secondary').click();
    log('data', `${name} → 「${await msg(page)}」${dlg ? '（確認の箱が出た）' : ''}`);
  }

  // 大きなファイル（bulk.json）
  const t0 = Date.now();
  await page.setInputFiles('#file', path.join(ROOT, 'tests/fixtures/debug/bulk.json'));
  await confirmYes(page);
  await page.waitForFunction(() => /復元しました|でき/.test(document.querySelector('#msg')?.textContent ?? ''), null, { timeout: 60000 });
  log('data', `bulk.json の復元 ${Date.now() - t0}ms → 「${await msg(page)}」`);

  // 復元してすぐ、もう一度同じファイルで復元（復元中にもう一度選ぶ）
  await page.click('#clear'); await confirmYes(page); await confirmYes(page);
  await page.waitForFunction(() => document.querySelector('#msg')?.textContent.includes('消しました'));
  await page.setInputFiles('#file', path.join(ROOT, 'tests/fixtures/debug/bulk.json'));
  await confirmYes(page);
  await page.setInputFiles('#file', path.join(ROOT, 'tests/fixtures/debug/bulk.json'));
  await confirmYes(page);
  await page.waitForTimeout(4000);
  log('data', `bulk の復元中にもう一度復元 → 「${await msg(page)}」 ${JSON.stringify(counts(await dump(page)))}`);

  // CSV
  const csvDl = [];
  page.on('download', (d) => csvDl.push(d));
  await page.click('#exportCsv');
  await page.waitForTimeout(1500);
  for (const d of csvDl) {
    const p = path.join(tmp, d.suggestedFilename());
    await d.saveAs(p);
    const txt = await readFile(p, 'utf8');
    log('data', `CSV ${d.suggestedFilename()}：${txt.split('\n').length}行、BOM=${txt.charCodeAt(0) === 0xfeff}`);
  }
  log('data', `自動ファイル保存のカード：hidden=${await page.locator('#autosaveCard').getAttribute('hidden')}`);
  log('data', `画面のエラー：${errors.join(' / ') || 'なし'}`);
  await ctx.close();
}

// 2台で書き出しファイルをやりとりする：A で設定を変える → B で書き出す（B の習慣） → A で書き出す → B で復元
if (on('data')) {
  const A = await newPage();
  const B = await newPage();
  for (const x of [A, B]) { await x.page.goto(`${srv.base}/data.html`); await loadFixture(x.page, 'minimal'); }
  await A.page.evaluate(async () => {
    const { openDb, updateSettings } = await import('/js/db.js');
    const db = openDb(); await updateSettings(db, { defaultDoseG: 18, caffeineCutoff: '14:00' }); db.close();
  });
  await A.page.waitForTimeout(50);
  for (const x of [B, A]) {
    await x.page.reload();
    const dl = x.page.waitForEvent('download');
    await x.page.click('#export');
    x.file = path.join(tmp, `dev-${x === A ? 'A' : 'B'}.json`);
    await (await dl).saveAs(x.file);
    await x.page.waitForTimeout(50);
  }
  await B.page.evaluate(() => { document.querySelector('#msg').textContent = ''; });
  await B.page.setInputFiles('#file', A.file);
  await confirmYes(B.page);
  await B.page.waitForFunction(() => /復元しました|でき/.test(document.querySelector('#msg')?.textContent ?? ''));
  const sB = (await dump(B.page)).settings[0];
  log('data', `2台：A で粉量18g・控える時刻14:00 → B 書き出し → A 書き出し → B で A のファイルを復元 → 「${await msg(B.page)}」 B の設定 defaultDoseG=${sB?.defaultDoseG} caffeineCutoff=${sB?.caffeineCutoff}`);
  await A.ctx.close(); await B.ctx.close();
}

// ---------------------------------------------------------------- 2. 保存が使えない
const PAGES = ['index.html', 'brew.html', 'beans.html', 'data.html', 'tasting.html', 'analysis.html', 'more.html', 'recipes.html', 'weather.html', 'today.html'];
async function visibleText(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    return main.innerText.replace(/\s+/g, ' ').slice(0, 160);
  });
}
if (on('storage')) {
  const modes = {
    'localStorage が投げる': () => {
      for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { get() { throw new DOMException('denied', 'SecurityError'); } });
    },
    'IndexedDB.open が投げる': () => {
      IDBFactory.prototype.open = function () { throw new DOMException('denied', 'InvalidStateError'); };
    },
    'indexedDB がない': () => {
      Object.defineProperty(window, 'indexedDB', { get() { return undefined; } });
    },
    'IndexedDB.open が失敗（onerror）': () => {
      const real = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...a) {
        const req = real.apply(this, a);
        const fake = { onerror: null, onsuccess: null, onupgradeneeded: null, onblocked: null, error: new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError'), addEventListener() {}, removeEventListener() {} };
        req.onsuccess = () => { req.result.close(); setTimeout(() => fake.onerror?.({ target: fake, preventDefault() {}, stopPropagation() {} })); };
        return fake;
      };
    },
  };
  for (const [label, init] of Object.entries(modes)) {
    const { ctx, page, errors } = await newPage();
    await ctx.addInitScript(init);
    for (const p of PAGES) {
      errors.length = 0;
      await page.goto(`${srv.base}/${p}`).catch(() => {});
      await page.waitForTimeout(1200);
      const err = await page.evaluate(() => [...document.querySelectorAll('.error,[role=alert]')].filter((e) => e.offsetParent && e.textContent.trim()).map((e) => e.textContent.trim().slice(0, 60)));
      log('storage', `${label} / ${p}：赤い文=${JSON.stringify(err)} 画面=「${await visibleText(page)}」 エラー=${errors.slice(0, 2).join(' | ')}`);
    }
    await ctx.close();
  }
  // 空きが少ない（CDP）
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(`${srv.base}/data.html`);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: srv.base, quotaSize: 200 * 1024 });
    await page.reload();
    await page.waitForTimeout(800);
    await page.setInputFiles('#file', path.join(ROOT, 'tests/fixtures/debug/bulk.json'));
    await confirmYes(page);
    await page.waitForFunction(() => /復元しました|でき/.test(document.querySelector('#msg')?.textContent ?? ''), null, { timeout: 60000 });
    log('storage', `空き200KBで bulk.json を復元 → 「${await msg(page)}」 ${JSON.stringify(counts(await dump(page)))}`);
    // 小さいデータを入れて、抽出を保存する（空きが足りない）
    await loadFixture(page, 'minimal').catch((e) => log('storage', `minimal も入らない：${e.message.slice(0, 80)}`));
    await page.goto(`${srv.base}/brew.html`);
    await page.waitForTimeout(1000);
    log('storage', `空き200KB：抽出の画面「${await visibleText(page)}」 エラー=${errors.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 共通：天気の返事を作る
function weatherJson({ temp = 22, maxC = 24 } = {}) {
  const now = Math.floor(Date.now() / 3600000) * 3600;
  const time = [];
  for (let t = now - 3 * 86400; t <= now + 86400; t += 3600) time.push(t);
  const days = [];
  for (let t = now - 3 * 86400; t <= now + 86400; t += 86400) days.push(t - (t % 86400) - 9 * 3600);
  return {
    utc_offset_seconds: 32400,
    hourly: { time, temperature_2m: time.map(() => temp), relative_humidity_2m: time.map(() => 60), weather_code: time.map(() => 1) },
    daily: { time: days, temperature_2m_max: days.map(() => maxC) },
  };
}
/** 天気の問い合わせを Playwright で受ける（本物には問い合わせない） */
async function routeWeather(ctx, mode) {
  const hits = [];
  await ctx.route(/open-meteo\.com/, async (route) => {
    hits.push(route.request().url());
    const m = typeof mode === 'function' ? mode() : mode;
    if (m === 'abort') return route.abort('internetdisconnected');
    if (m === '500') return route.fulfill({ status: 500, body: 'error' });
    if (m === 'slow') { await new Promise((r) => setTimeout(r, 12000)); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(weatherJson()) }).catch(() => {}); }
    if (m === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>captive portal</html>' });
    if (m === 'empty') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (m === 'hot9999') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(weatherJson({ temp: 9999, maxC: 9999 })) });
    if (m === 'strings') { const j = weatherJson(); j.hourly.temperature_2m = j.hourly.temperature_2m.map(String); j.daily.temperature_2m_max = j.daily.temperature_2m_max.map(() => '35'); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); }
    if (m === 'hot') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(weatherJson({ temp: 33, maxC: 35 })) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(weatherJson()) });
  });
  return hits;
}
async function setPlace(page) {
  await page.evaluate(async () => {
    const { openDb, updateSettings } = await import('/js/db.js');
    const db = openDb(); await updateSettings(db, { weatherPlace: { key: 'tokyo', name: '東京', lat: 35.69, lon: 139.69 } }); db.close();
  });
}
const firstRecipe = (page) => page.evaluate(async () => {
  const { openDb, listRecipes } = await import('/js/db.js');
  const db = openDb(); const r = await listRecipes(db); db.close(); return r[0]?.id;
});
/** 淹れる画面から「タイマーを使わずに記録する」→ 保存する */
async function brewNoTimer(page, base, recipeId) {
  await page.goto(`${base}/brew.html?recipe=${recipeId}`);
  await page.click('#noTimer');
  await page.locator('#resultView').waitFor();
  await page.locator('#rTotal').fill('3:30');
  await page.click('#resultView button[type=submit]');
  await page.waitForURL(/tasting\.html/, { timeout: 10000 }).catch(() => {});
  return page.url();
}

// 空きがほとんど残っていない（記録が入ったあとで満杯に近づく）：抽出の保存・復元・評価で何が出るか
if (on('storage')) {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${srv.base}/data.html`);
  await loadFixture(page, 'demo');
  const rid = await firstRecipe(page);
  const used = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: srv.base, quotaSize: used + 2 * 1024 });
  await page.goto(`${srv.base}/brew.html?recipe=${rid}`);
  await page.waitForTimeout(800);
  log('storage', `使用 ${Math.round(used / 1024)}KB・空き2KB：淹れる画面「${(await visibleText(page)).slice(0, 60)}」`);
  await page.click('#noTimer').catch(() => {});
  await page.locator('#rTotal').fill('3:30').catch(() => {});
  await page.locator('#rMemo').fill('あ'.repeat(3000)).catch(() => {});
  await page.click('#resultView button[type=submit]').catch(() => {});
  await page.waitForTimeout(1500);
  log('storage', `  保存する → URL ${page.url().split('/').pop().slice(0, 30)} 「${await page.locator('#rMsg').innerText().catch(() => '')}」 エラー=${errors.slice(-1).join('').slice(0, 120)}`);
  await page.goto(`${srv.base}/data.html`);
  await page.waitForTimeout(800);
  await page.setInputFiles('#file', path.join(ROOT, 'tests/fixtures/debug/bulk.json'));
  await confirmYes(page);
  await page.waitForFunction(() => /復元しました|でき/.test(document.querySelector('#msg')?.textContent ?? ''), null, { timeout: 60000 });
  log('storage', `  bulk.json を復元 → 「${await msg(page)}」 エラー=${errors.slice(-1).join('').slice(0, 160)}`);
  log('storage', `  そのときのエラーの名前：${await page.evaluate(async () => {
    const { openDb, restoreBackup } = await import('/js/db.js'); const { parseBackup } = await import('/js/core/backup.js');
    const bk = parseBackup(await (await fetch('/tests/fixtures/debug/bulk.json')).text());
    try { await restoreBackup(openDb(), bk); return 'ok'; } catch (e) { return `${e.name} / ${e.inner?.name ?? ''} / ${e.message.slice(0, 100)}`; }
  })}`);
  await ctx.close();
}

// ---------------------------------------------------------------- 3. 天気（失敗・遅い・おかしな中身）
if (on('weather')) {
  for (const mode of ['ok', 'abort', '500', 'slow', 'html', 'empty', 'strings', 'hot9999', 'hot']) {
    const { ctx, page, errors } = await newPage();
    const hits = await routeWeather(ctx, mode);
    await page.goto(`${srv.base}/data.html`);
    await loadFixture(page, 'minimal');
    await setPlace(page);
    const t0 = Date.now();
    await page.goto(`${srv.base}/weather.html`);
    await page.waitForFunction(() => !document.querySelector('#state')?.textContent.includes('読み込み中'), null, { timeout: 20000 }).catch(() => {});
    const ms = Date.now() - t0;
    await page.waitForTimeout(mode === 'slow' ? 11000 : 500);
    const state = (await page.locator('#state').innerText()).replace(/\s+/g, ' ').slice(0, 140);
    const sm = await page.locator('#stateMsg').innerText();
    await page.goto(`${srv.base}/index.html`);
    await page.waitForTimeout(mode === 'slow' ? 11000 : 1500);
    const hot = await page.locator('#hotCard').isVisible().catch(() => false) ? (await page.locator('#hotCard').innerText()).replace(/\s+/g, ' ').slice(0, 100) : '（暑い日のカードなし）';
    const home = await visibleText(page);
    // 天気が付いている状態で淹れて保存
    const rid = await firstRecipe(page);
    const url = await brewNoTimer(page, srv.base, rid);
    log('weather', `${mode}：問い合わせ${hits.length}回、天気の画面 ${ms}ms「${state}」知らせ「${sm}」 ホーム：${hot} / 保存→${url.split('/').pop().slice(0, 30)} エラー=${errors.filter((e) => !e.includes('天気を取れ')).slice(0, 2).join(' | ')}`);
    if (mode === 'ok') log('weather', `  ホーム：${home.slice(0, 80)}`);
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 3b. 自動ファイル保存（PCだけ）：フォルダの代わりに OPFS を渡して試す
if (on('autosave')) {
  // ふつうの newContext だと、フォルダの情報を保存場所に置いたときにブラウザが落ちる（点検の環境の都合）ので、プロファイルを作って開く
  const ctx = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'pf-prof-')), { channel: 'chromium', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await ctx.addInitScript(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Backup', { create: true });
    FileSystemHandle.prototype.queryPermission = async () => 'granted';
    FileSystemHandle.prototype.requestPermission = async () => 'granted';
  });
  const readFileInOpfs = () => page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Backup', { create: true });
    const names = []; for await (const k of dir.keys()) names.push(k);
    if (!names.length) return null;
    const f = await (await dir.getFileHandle(names[0])).getFile();
    const j = JSON.parse(await f.text());
    return { name: names[0], brews: j.tables.brews.length, settings: j.tables.settings[0] ?? null };
  });
  await page.goto(`${srv.base}/data.html`);
  await loadFixture(page, 'minimal');
  await page.reload();
  await page.locator('#autosaveCard').waitFor();
  await page.click('#autosaveChoose');
  await page.waitForTimeout(800);
  log('autosave', `フォルダを選ぶ → 「${await msg(page)}」 ファイル ${JSON.stringify(await readFileInOpfs())}`);
  const sBefore = (await dump(page)).settings[0];
  const rid = await firstRecipe(page);
  await brewNoTimer(page, srv.base, rid);
  await page.waitForTimeout(500);
  const sAfter = (await dump(page)).settings[0];
  log('autosave', `1杯保存 → ファイル ${JSON.stringify(await readFileInOpfs())}`);
  log('autosave', `  設定の updatedAt：保存前 ${sBefore?.updatedAt} → 保存後 ${sAfter?.updatedAt}（lastBackupAt ${sAfter?.lastBackupAt}）`);
  await page.goto(`${srv.base}/data.html`);
  await page.click('#clear'); await confirmYes(page); await confirmYes(page);
  await page.waitForFunction(() => document.querySelector('#msg')?.textContent.includes('消しました'));
  log('autosave', `全部消す → 「${await msg(page)}」 ファイル ${JSON.stringify(await readFileInOpfs())}`);
  // 消したあと、ファイルから復元する前に別の記録を入れて1杯保存する
  await loadFixture(page, 'minimal');
  await brewNoTimer(page, srv.base, await firstRecipe(page));
  await page.waitForTimeout(500);
  log('autosave', `消したあと1杯保存 → ファイル ${JSON.stringify(await readFileInOpfs())}`);
  log('autosave', `エラー=${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
}

// ---------------------------------------------------------------- 4. オフライン → オンライン（本番と同じ Service Worker）
async function waitController(page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 60000 });
}
async function swReady(page) {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const st = await new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = (e) => res(e.data); reg.active.postMessage({ type: 'status' }, [ch.port2]); setTimeout(() => res(null), 3000); });
    return { ...st, caches: await caches.keys() };
  });
}
const htmlPages = async () => Object.keys(JSON.parse((await readFile(path.join(ROOT, 'sw.js'), 'utf8')).match(/const MANIFEST = (\{[\s\S]*?\n\});/)[1]).files).filter((f) => f.endsWith('.html'));

if (on('offline')) {
  const { ctx, page, errors } = await newPage();
  const hits = await routeWeather(ctx, () => 'ok');
  await page.goto(`${srv.prodBase}/index.html`);
  await waitController(page);
  log('offline', `Service Worker：${JSON.stringify(await swReady(page))}`);
  await loadFixture(page, 'minimal');
  await setPlace(page);
  await ctx.setOffline(true);
  const bad = [];
  for (const p of await htmlPages()) {
    errors.length = 0;
    const res = await page.goto(`${srv.prodBase}/${p}`).catch((e) => ({ status: () => e.message.slice(0, 40) }));
    await page.waitForTimeout(400);
    const txt = await visibleText(page);
    const errs = errors.filter((e) => !/天気|open-meteo|ERR_INTERNET_DISCONNECTED/.test(e));
    if (res?.status?.() !== 200 || errs.length || /読み込めませんでした|undefined|NaN/.test(txt)) bad.push(`${p}：${res?.status?.()} ${errs.slice(0, 1).join('')} ${txt.slice(0, 60)}`);
  }
  log('offline', `通信なしで全画面（${(await htmlPages()).length}）→ 問題 ${bad.length} 件 ${bad.join(' / ')}`);
  // ?付き・#付き・ / の URL
  for (const u of ['/', '/brew.html?recipe=xxx', '/index.html#top', '/data.html?dev', '/nope.html']) {
    const r = await page.goto(srv.prodBase + u).catch((e) => ({ status: () => e.message.split('\n')[0].slice(0, 50) }));
    await page.waitForTimeout(800);
    log('offline', `通信なしで ${u} → ${r?.status?.()} 「${(await visibleText(page).catch(() => '')).slice(0, 50)}」`);
  }
  // 通信なしで淹れて保存、天気の画面
  await page.goto(`${srv.prodBase}/index.html`);
  const rid = await firstRecipe(page);
  const url = await brewNoTimer(page, srv.prodBase, rid);
  log('offline', `通信なしで淹れて保存 → ${url.split('/').pop()}`);
  await page.goto(`${srv.prodBase}/weather.html`);
  await page.waitForTimeout(1500);
  log('offline', `通信なしの天気の画面：「${(await page.locator('#state').innerText()).replace(/\s+/g, ' ').slice(0, 100)}」 知らせ「${await page.locator('#stateMsg').innerText()}」`);
  await page.goto(`${srv.prodBase}/data.html`);
  for (const w of [1500, 4000, 6000]) {
    await page.waitForTimeout(w === 1500 ? 1500 : w - 1500);
    log('offline', `通信なしのデータの画面 ${w}ms：「${await page.locator('#offlineStatus').innerText()}」「${await page.locator('#appVersionLabel').innerText()}」`);
  }
  log('offline', `  エラー=${errors.filter((e) => !/天気|open-meteo/.test(e)).slice(-3).join(' | ')}`);
  const before = hits.length;
  await ctx.setOffline(false);
  await page.goto(`${srv.prodBase}/index.html`);
  await page.waitForTimeout(2000);
  const brews = (await dump(page)).brews;
  log('offline', `通信が戻ってホーム → 天気の問い合わせ ${hits.length - before} 回、杯の天気：${JSON.stringify(brews.map((b) => b.context?.weather ?? null)).slice(0, 160)}`);
  await ctx.close();
}

// ---------------------------------------------------------------- 5. Service Worker の更新（古い版 → 今の版）
if (on('sw')) {
  const OLD = process.env.OLD_ROOT;
  if (!OLD) log('sw', 'OLD_ROOT がないので飛ばす');
  else {
    // 5-1 初めて・遅い回線
    {
      srv.root = ROOT; srv.delayMs = 150;
      const { ctx, page, errors } = await newPage();
      const t0 = Date.now();
      await page.goto(`${srv.prodBase}/index.html`);
      const shown = Date.now() - t0;
      await waitController(page);
      log('sw', `初めて・1ファイル150ms遅れ：画面 ${shown}ms、オフラインの準備 ${Date.now() - t0}ms ${JSON.stringify(await swReady(page))} エラー=${errors.slice(0, 2).join(' | ')}`);
      srv.delayMs = 0;
      await ctx.close();
    }
    // 5-2 準備中に1つのファイルが取れない
    {
      srv.root = ROOT; srv.fail = (p) => p === '/js/core/wrapped.js';
      const { ctx, page } = await newPage();
      await page.goto(`${srv.prodBase}/data.html`);
      await page.waitForTimeout(7000);
      const st = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { active: !!r?.active, installing: !!r?.installing, waiting: !!r?.waiting, caches: await caches.keys() }; });
      log('sw', `初めて・1ファイルが503：${JSON.stringify(st)} 画面「${await page.locator('#offlineStatus').innerText()}」`);
      srv.fail = () => false;
      await page.reload();
      await page.waitForTimeout(4000);
      log('sw', `  取れるようになって開き直す → 「${await page.locator('#offlineStatus').innerText()}」`);
      await ctx.close();
    }
    // 5-3 古い版 → 今の版
    srv.root = OLD;
    const { ctx, page, errors } = await newPage();
    await page.clock.install();
    await routeWeather(ctx, 'ok');
    await page.goto(`${srv.prodBase}/index.html`);
    await waitController(page);
    log('sw', `古い版を入れた：${JSON.stringify(await swReady(page))}`);
    await loadFixture(page, 'minimal');
    const rid = await firstRecipe(page);
    // 淹れている途中（タイマー中）
    await page.goto(`${srv.prodBase}/brew.html?recipe=${rid}`);
    await page.click('#start');
    await page.waitForTimeout(2500);
    await page.click('#tap');
    await page.waitForTimeout(500);
    const draftOld = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k).slice(0, 80)])));
    log('sw', `古い版で淹れている途中：${JSON.stringify(draftOld)}`);
    // サーバーを今の版に替えて、別の画面（ホーム）を開く → 戻る
    srv.root = ROOT;
    const page2 = await ctx.newPage();
    const errors2 = collectErrors(page2);
    await page2.goto(`${srv.prodBase}/index.html`);
    await page2.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting, null, { timeout: 60000 }).catch(() => log('sw', '新しい版が waiting にならない'));
    await page2.waitForTimeout(800);
    const bar2 = (await page2.locator('#updateBar').innerText().catch(() => '（知らせなし）')).replace(/\s+/g, ' ');
    const bar1 = (await page.locator('#updateBar').innerText().catch(() => '（知らせなし）')).replace(/\s+/g, ' ');
    log('sw', `今の版を置いた：ホームのタブ「${bar2}」、淹れている途中のタブ「${bar1}」`);
    // ホームのタブで「更新する」を押す（淹れている途中のタブは開いたまま）
    if (bar2.includes('更新')) {
      await Promise.all([page2.waitForEvent('load', { timeout: 15000 }).catch(() => log('sw', '更新して読み直さない')), page2.click('#updateBar button')]);
      await page2.waitForTimeout(1500);
      log('sw', `更新した：${JSON.stringify(await swReady(page2))} ホームのタブ「${(await visibleText(page2)).slice(0, 80)}」 エラー=${errors2.slice(0, 2).join(' | ')}`);
      // 淹れている途中のタブ：古い画面のまま、続けて「落ち切った」→ 保存
      const timerShown = await page.locator('#timerView').isVisible();
      log('sw', `淹れている途中のタブ：タイマー表示=${timerShown}、版=${await page.evaluate(async () => (await import('/js/core/version.js')).APP_VERSION).catch((e) => e.message.slice(0, 60))}`);
      // 古い画面で、読み込みの終わっていない画面へ移る（新しい版のファイルだけになるか）
      for (let i = 0; i < 12 && (await page.locator('#timerView').isVisible()); i++) { await page.clock.fastForward('01:00'); await page.click('#tap'); await page.waitForTimeout(300); }
      log('sw', `  タップのあと：タイマー=${await page.locator('#timerView').isVisible()} 実績=${await page.locator('#resultView').isVisible()} 「${(await page.locator('#rMsg').innerText().catch(() => ''))}」`);
      await page.locator('#resultView').waitFor({ timeout: 5000 }).catch(() => {});
      await page.locator('#rTotal').fill('3:30').catch(() => {});
      await page.click('#resultView button[type=submit]').catch(() => {});
      await page.waitForURL(/tasting\.html/, { timeout: 10000 }).catch(() => {});
      log('sw', `古い画面のまま保存 → ${page.url().split('/').pop().slice(0, 40)}「${(await visibleText(page)).slice(0, 60)}」 エラー=${errors.slice(0, 3).join(' | ')}`);
    }
    // 開き直す：途中の下書きが残るか（新しい版で）
    await ctx.close();
  }
  // 5-4 淹れている途中のまま、アプリを閉じて開き直す（待っている版が自動で切り替わる）
  if (OLD) {
    srv.root = OLD;
    const { ctx, page, errors } = await newPage();
    await page.goto(`${srv.prodBase}/index.html`);
    await waitController(page);
    await loadFixture(page, 'minimal');
    const rid = await firstRecipe(page);
    await page.goto(`${srv.prodBase}/brew.html?recipe=${rid}`);
    await page.click('#start');
    await page.waitForTimeout(2500);
    await page.click('#tap');
    srv.root = ROOT;
    await page.reload({ timeout: 20000 }).catch((e) => log('sw', `淹れている途中の再読み込みが終わらない：${e.message.split('\n')[0]}`)); // 更新の確認が走る
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting, null, { timeout: 60000 }).catch(() => {});
    const bar = await page.locator('#updateBar').count();
    log('sw', `淹れている途中で開き直す（古い版のまま）：知らせ ${bar} 個、タイマー=${await page.locator('#timerView').isVisible()}`);
    // 全部の画面を閉じる → 新しい版が有効になる
    log('sw', `  「このページを離れますか」：${errors.beforeunload ?? 0} 回`);
    await page.close();
    await new Promise((r) => setTimeout(r, 1500));
    const p3 = await ctx.newPage();
    const errors3 = collectErrors(p3);
    await p3.goto(`${srv.prodBase}/brew.html?recipe=${rid}`);
    await p3.waitForTimeout(2000);
    log('sw', `全部閉じて開き直す：${JSON.stringify(await swReady(p3))} 画面「${(await visibleText(p3)).slice(0, 80)}」 タイマー=${await p3.locator('#timerView').isVisible()}「${(await p3.locator('#timerView').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 80)}」 下書き=${await p3.evaluate(() => !!localStorage.getItem('pourfolio.brewDraft'))} エラー=${errors3.slice(0, 2).join(' | ')}`);
    if (await p3.locator('#resume').isVisible()) {
      await p3.click('#resume');
      await p3.waitForTimeout(800);
      log('sw', `  続きに戻る → タイマー表示=${await p3.locator('#timerView').isVisible()} 「${(await p3.locator('#timerView').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 80)}」 エラー=${errors3.slice(0, 2).join(' | ')}`);
    }
    await ctx.close();
  }
}

await browser.close();
await srv.stop();
