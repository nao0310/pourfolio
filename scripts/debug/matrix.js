// 総仕上げ：ブラウザの設定を組み合わせて全画面を点検する。アプリには含めない（scripts/ は sw.js の一覧に入らない）。
// 使い方：node scripts/debug/matrix.js [設定の名前…] [--quick] [--out=フォルダ]
//   設定の名前を省くと全部。--quick は画面を減らす（試しに回すとき）。
//   結果：<out>/matrix.json と、表（Markdown）を標準出力に。docs/debug/matrix.md に貼る。
// 1つの設定だけで確かめると、その設定でしか起きない（起きない）問題を見逃すため、次を組み合わせる：
//   言語（ja-JP・en-US・zh-CN）×時刻の地域（Asia/Tokyo・UTC・America/Los_Angeles）、ライト・ダーク、動きを減らす、
//   強いコントラスト（forced-colors）、拡大200%、最小フォントサイズ、文字を大きく（既定の文字の大きさ）、
//   iPhone の機種（isMobile・hasTouch・deviceScaleFactor）・横向き・PC、保存が使えない・空きが少ない、
//   オフライン・遅い回線・キャッシュなしの初回、天気の問い合わせの失敗、時計（朝5時・月末・年末年始）、
//   まっさらなブラウザとデータの入ったブラウザ。
// どの設定も毎回まっさらなブラウザのプロファイルで開く（作業用のブラウザの記憶やキャッシュで問題が隠れないように）。
// WebKit（Safari）はこの環境にないので、Safari だけで起きることは docs/iphone-check-final.md でユーザーが確かめる。
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { chromium, startServer, launch, loadFixture, collectErrors, isChineseFont, ROOT } from './pw-lib.js';

// 点検の中身（audit.js）は blob の URL で画面に渡す（オフラインでも動くように。/js/ は画面の場所からの絶対URLに）
const AUDIT_SRC = readFileSync(path.join(ROOT, 'scripts/debug/audit.js'), 'utf8');
const importAudit = `(async () => { const src = window.__AUDIT_SRC__.replaceAll("import('/js/", "import('" + location.origin + "/js/"); return import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); })()`;
async function audit(page, fnBody, arg) {
  await page.evaluate((src) => { window.__AUDIT_SRC__ = src; }, AUDIT_SRC);
  return page.evaluate(`(async (arg) => { const m = await ${importAudit}; ${fnBody} })(${JSON.stringify(arg ?? null)})`);
}

const require = createRequire(import.meta.url);
const { devices } = require('playwright');
const PORT = 8096;

const dev = (name) => {
  const d = { ...devices[name] };
  delete d.defaultBrowserType;
  return d;
};
const PC = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };

// どの2つの条件の組も、どこかで1回は出会うように選んだ組み合わせ
export const PROFILES = [
  { name: 'P01 基本', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'light', device: 'iPhone 13', data: 'demo' },
  { name: 'P02 ダーク・意地悪', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'dark', device: 'iPhone 13', data: 'nasty', every: true },
  { name: 'P03 英語・LA・SE', locale: 'en-US', tz: 'America/Los_Angeles', scheme: 'light', device: 'iPhone SE', data: 'demo' },
  { name: 'P04 中国語・UTC・ダーク・大きい機種', locale: 'zh-CN', tz: 'UTC', scheme: 'dark', device: 'iPhone 15 Pro Max', data: 'demo' },
  { name: 'P05 横向き・動きを減らす・UTC', locale: 'ja-JP', tz: 'UTC', scheme: 'light', device: 'iPhone 13 landscape', reducedMotion: 'reduce', data: 'minimal' },
  { name: 'P06 強いコントラスト（ダーク）・英語', locale: 'en-US', tz: 'Asia/Tokyo', scheme: 'dark', forcedColors: 'active', device: 'iPhone 13', data: 'demo' },
  { name: 'P07 PC・中国語・LA・大量', locale: 'zh-CN', tz: 'America/Los_Angeles', scheme: 'light', pc: true, data: 'bulk' },
  { name: 'P08 PC・拡大200%', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'light', zoom: 2, data: 'demo' },
  { name: 'P09 文字を大きく（既定24px）・意地悪', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'dark', device: 'iPhone 13', fontPx: 24, data: 'nasty' },
  { name: 'P10 最小フォント16px・英語・UTC', locale: 'en-US', tz: 'UTC', scheme: 'light', device: 'iPhone SE', minFontPx: 16, data: 'demo' },
  { name: 'P11 localStorage が使えない（まっさら）', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'light', device: 'iPhone 13', block: 'localStorage', data: null },
  { name: 'P12 IndexedDB が使えない（まっさら）', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'dark', device: 'iPhone 13', block: 'indexedDB', data: null },
  { name: 'P13 空きが少ない（デモを入れようとする）', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'light', device: 'iPhone SE', quota: 16 * 1024, data: 'demo' },
  { name: 'P14 オフライン（Service Worker のあと）', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'light', device: 'iPhone 13', prod: true, offline: true, data: 'demo' },
  { name: 'P15 遅い回線・キャッシュなしの初回', locale: 'en-US', tz: 'Asia/Tokyo', scheme: 'dark', device: 'iPhone SE', prod: true, delayMs: 400, data: null },
  { name: 'P16 天気の問い合わせが失敗', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'light', device: 'iPhone 13', weather: 'error', data: 'demo' },
  { name: 'P17 朝4:59（東京）', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'dark', device: 'iPhone 13', clock: '2026-11-19T04:59:30+09:00', data: 'demo' },
  { name: 'P18 月末23:59（UTC）', locale: 'zh-CN', tz: 'UTC', scheme: 'light', device: 'iPhone 13', clock: '2026-11-30T23:59:30Z', data: 'demo' },
  { name: 'P19 大みそか23:59（LA）', locale: 'en-US', tz: 'America/Los_Angeles', scheme: 'dark', device: 'iPhone SE', clock: '2026-12-31T23:59:30-08:00', data: 'demo' },
  { name: 'P20 元日0:30（東京）・空', locale: 'ja-JP', tz: 'Asia/Tokyo', scheme: 'light', device: 'iPhone 13', clock: '2027-01-01T00:30:00+09:00', data: 'empty' },
];

const QUICK_PAGES = ['index.html', 'today.html', 'beans.html', 'brew.html', 'analysis.html', 'calendar.html', 'data.html', 'more.html', 'wrapped.html', 'weather.html'];

/** 保存を使えなくする（プライベートブラウズの古い Safari など）。画面のスクリプトより先に動く */
function blockScript(kind) {
  if (kind === 'localStorage') {
    return `for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });`;
  }
  return `IDBFactory.prototype.open = function () { throw new DOMException('blocked for test', 'InvalidStateError'); };`;
}

async function openContext(browser, p, srv) {
  const opts = {
    locale: p.locale,
    timezoneId: p.tz,
    colorScheme: p.scheme,
    reducedMotion: p.reducedMotion ?? 'no-preference',
    forcedColors: p.forcedColors ?? 'none',
    serviceWorkers: 'allow',
    ...(p.pc ? PC : p.zoom ? { ...PC, viewport: { width: 1280 / p.zoom, height: 800 / p.zoom }, deviceScaleFactor: p.zoom } : dev(p.device ?? 'iPhone 13')),
  };
  let ctx;
  let persistentBrowser = null;
  if (p.minFontPx) {
    // 最小フォントサイズは Chrome の設定ファイルでしか変えられないので、まっさらなプロファイルに書いてから開く
    const dir = await mkdtemp(path.join(tmpdir(), 'pf-minfont-'));
    await mkdir(path.join(dir, 'Default'), { recursive: true });
    await writeFile(path.join(dir, 'Default/Preferences'), JSON.stringify({ webkit: { webprefs: { minimum_font_size: p.minFontPx, minimum_logical_font_size: p.minFontPx } } }));
    ctx = await chromium.launchPersistentContext(dir, { ...opts, channel: 'chromium', args: ['--host-resolver-rules=MAP pourfolio.test 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=${srv.prodBase}`] });
    persistentBrowser = ctx;
  } else {
    ctx = await browser.newContext(opts);
  }
  if (p.block) await ctx.addInitScript(blockScript(p.block));
  if (p.clock) await ctx.clock.install({ time: new Date(p.clock) });
  // 外への通信（天気）は、ここでは本物に出さない
  await ctx.route(/open-meteo\.com/, (route) => (p.weather === 'error' ? route.fulfill({ status: 500, body: 'error' }) : route.abort('internetdisconnected')));
  return { ctx, close: () => (persistentBrowser ? persistentBrowser.close() : ctx.close()) };
}

async function applyPageTweaks(page, p) {
  if (p.fontPx) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: p.fontPx, fixed: Math.round(p.fontPx * 0.8) } });
  }
}

async function checkPage(page, url, p, errors) {
  const before = errors.length;
  const res = { page: url.replace(/=[0-9a-f-]{36}/g, '=ID') };
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  } catch (e) {
    res.navError = e.message.split('\n')[0];
  }
  await page.waitForTimeout(p.delayMs ? 2500 : 1300);
  try {
    const r = await audit(page, `
      const out = m.inspect(window, { w: innerWidth });
      // 中身をいちばん下までスクロールしても、下のタブが画面のいちばん下のままか（D-184）
      const mainBox = document.querySelector('main');
      const tabBar = document.querySelector('nav.tabbar');
      if (mainBox && tabBar && getComputedStyle(tabBar).display !== 'none') {
        mainBox.scrollTop = mainBox.scrollHeight;
        await new Promise((r) => setTimeout(r, 50));
        const b = tabBar.getBoundingClientRect().bottom;
        if (Math.abs(b - innerHeight) > 1 || scrollY !== 0) out.tabbarAfterScroll = { bottom: Math.round(b), innerHeight, scrollY };
        mainBox.scrollTop = 0;
      }
      const main = document.querySelector('main');
      if (!main || main.innerText.trim().length < 8) out.blank = true;
      out.movedTo = location.pathname.split('/').pop() + location.search;
      return out;`);
    if (p.forcedColors) delete r.lowContrast; // 強いコントラストでは色を OS が決める
    const target = new URL(url).pathname.split('/').pop() + new URL(url).search;
    if (r.movedTo === target) delete r.movedTo;
    Object.assign(res, r);
  } catch (e) {
    res.inspectError = e.message.split('\n')[0];
  }
  // 字形：見出し・ボタン・下のタブ・入力欄を描いたフォント
  try {
    const { platformFonts } = await import('./pw-lib.js');
    const f = await platformFonts(page, ['h1', 'main button', '.tabbar a', 'main input[type=text]', 'main select']);
    const zh = Object.entries(f).filter(([, n]) => n[0] && isChineseFont(n[0])).map(([s, n]) => `${s}:${n[0]}`);
    if (zh.length) res.chineseGlyph = zh;
  } catch {}
  const errs = errors.slice(before).filter((e) => !/open-meteo|ERR_INTERNET_DISCONNECTED|Failed to load resource: net::ERR_FAILED/.test(e));
  if (errs.length) res.errors = [...new Set(errs)].slice(0, 6);
  return res;
}

export async function runProfile(browser, p, srv, { quick = false } = {}) {
  const base = p.prod ? srv.prodBase : srv.base;
  const { ctx, close } = await openContext(browser, p, srv);
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await applyPageTweaks(page, p);
  const notes = [];
  try {
    srv.delayMs = 0;
    await page.goto(`${base}/index.html`);
    await page.waitForTimeout(800);
    if (p.quota) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin: base, quotaSize: p.quota });
    }
    if (p.data && !p.block) {
      try {
        const counts = await loadFixture(page, p.data);
        notes.push(`データ ${p.data}：豆${counts.beans ?? '?'}・抽出${counts.brews ?? '?'}`);
      } catch (e) {
        notes.push(`データ ${p.data} を入れられない：${e.message.split('\n')[0].slice(0, 120)}`);
      }
    }
    if (p.prod) {
      // Service Worker が準備できるまで待つ（オフラインはこのあと）
      const ready = await page.evaluate(async () => {
        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 20000))]);
        return !!reg?.active;
      });
      notes.push(ready ? 'Service Worker 準備済み' : 'Service Worker が20秒で準備できない');
    }
    if (p.offline) await ctx.setOffline(true);
    if (p.delayMs) srv.delayMs = p.delayMs;
    let pages = quick ? QUICK_PAGES : null;
    if (!pages) {
      pages = await audit(page, `
        try {
          return await m.pagesWithIds({ every: arg });
        } catch {
          return m.PAGES; // 保存が使えないときは IDの要らない画面だけ
        }`, !!p.every);
    }
    if (p.offline) pages = pages.filter((u) => !u.includes('storage-test'));
    const rows = [];
    for (const u of [...new Set(pages)]) rows.push(await checkPage(page, `${base}/${u}`, p, errors));
    return { profile: p, notes, rows };
  } finally {
    srv.delayMs = 0;
    await close();
  }
}

const KINDS = {
  errors: '画面のエラー', navError: '開けない', inspectError: '点検できない', blank: '中身が空', overflowX: '横のはみ出し',
  clipped: '文字の切れ', loading: '読み込み中のまま', badText: 'undefined などの表示', badValue: '入力欄の変な値',
  smallTap: '44px未満', smallText: '12px未満の文字', lowContrast: '色の差が足りない', chineseGlyph: '中国語の字形', tabbarOff: '下のタブがずれている', tabbarAfterScroll: 'スクロールでタブがずれる', docScrolled: 'ページ全体がずれている', movedTo: '別の画面へ移った',
};

export function toMarkdown(results) {
  const lines = ['| 設定 | 言語・地域 | 色・表示 | 端末 | 保存・通信・時計 | データ | 画面数 | 見つかったこと |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const { profile: p, rows, notes } of results) {
    const counts = Object.entries(KINDS)
      .map(([k, label]) => [label, rows.filter((r) => r[k] != null).length])
      .filter(([, n]) => n)
      .map(([l, n]) => `${l} ${n}`)
      .join('、');
    const look = [p.scheme === 'dark' ? 'ダーク' : 'ライト', p.reducedMotion && '動きを減らす', p.forcedColors && '強いコントラスト', p.zoom && `拡大${p.zoom * 100}%`, p.fontPx && `既定の文字${p.fontPx}px`, p.minFontPx && `最小${p.minFontPx}px`].filter(Boolean).join('・');
    const env = [p.block && `${p.block} が使えない`, p.quota && `空き${Math.round(p.quota / 1024)}KB`, p.prod && '本番と同じ Service Worker', p.offline && 'オフライン', p.delayMs && `1ファイル${p.delayMs}ms`, p.weather && '天気が失敗', p.clock && `時計 ${p.clock}`].filter(Boolean).join('・') || '—';
    lines.push(`| ${p.name} | ${p.locale}・${p.tz} | ${look} | ${p.pc ? 'PC 1280' : p.zoom ? 'PC 1280（拡大）' : p.device} | ${env} | ${p.data ?? 'まっさら'}（${notes.join('／')}） | ${rows.length} | ${counts || 'なし'} |`);
  }
  return lines.join('\n');
}

export function details(results) {
  const out = [];
  for (const { profile: p, rows } of results) {
    for (const r of rows) {
      const ks = Object.keys(KINDS).filter((k) => r[k] != null);
      if (!ks.length) continue;
      out.push(`- ${p.name}｜${r.page}：${ks.map((k) => `${KINDS[k]} ${JSON.stringify(r[k]).slice(0, 220)}`).join('／')}`);
    }
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const outDir = path.resolve(args.find((a) => a.startsWith('--out='))?.slice(6) ?? 'matrix-out');
  const names = args.filter((a) => !a.startsWith('--'));
  const list = PROFILES.filter((p) => !names.length || names.some((n) => p.name.startsWith(n)));
  const parallel = Number(process.env.MATRIX_PARALLEL ?? 4);
  await mkdir(outDir, { recursive: true });
  const srv = await startServer(PORT);
  const browser = await launch({ ports: [PORT] });
  const results = [];
  try {
    const queue = [...list];
    await Promise.all(Array.from({ length: parallel }, async () => {
      while (queue.length) {
        const p = queue.shift();
        const t = Date.now();
        try {
          results.push(await runProfile(browser, p, srv, { quick }));
        } catch (e) {
          results.push({ profile: p, notes: [`設定を回せない：${e.message.split('\n')[0]}`], rows: [] });
        }
        console.error(`${p.name} 終わり（${Math.round((Date.now() - t) / 1000)}秒）`);
      }
    }));
  } finally {
    await browser.close();
    await srv.stop();
  }
  results.sort((a, b) => a.profile.name.localeCompare(b.profile.name));
  await writeFile(path.join(outDir, 'matrix.json'), JSON.stringify(results, null, 1));
  console.log(toMarkdown(results));
  console.log('\n### 画面ごと\n');
  console.log(details(results));
}
