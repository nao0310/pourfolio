// 総仕上げ（3-6 のあと）：Playwright で点検するときの共通部品。アプリには含めない（scripts/ は sw.js の一覧に入らない）。
// Node から使う（node scripts/debug/glyphs.js など）。Browserペインの道具（audit.js など）はそのまま page.evaluate で使う。
// ブラウザは毎回まっさらなプロファイル（newContext）で開くので、作業用のブラウザの記憶やキャッシュで問題が隠れない。
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

/**
 * 点検用のサーバー（8082〜8099）。scripts/serve.js と同じく ROOT のファイルを返すが、点検のために次を変えられる：
 * - srv.root を変える（古い版のフォルダ → 今のフォルダ。Service Worker の更新を試す）
 * - srv.delayMs（遅い回線）、srv.fail(path => bool)（そのファイルだけ 503）
 * - srv.requests（届いた要求の数。キャッシュなしの初回か、Service Worker から返したかを見る）
 * 終わったら stop()
 */
export async function startServer(port, { root = ROOT } = {}) {
  const srv = { root, delayMs: 0, fail: () => false, requests: [], base: `http://localhost:${port}`, prodBase: `http://pourfolio.test:${port}` };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    srv.requests.push(url.pathname);
    if (srv.delayMs) await new Promise((r) => setTimeout(r, srv.delayMs));
    if (srv.fail(url.pathname)) return res.writeHead(503).end('failed on purpose');
    let file = path.normalize(path.join(srv.root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(srv.root)) return res.writeHead(403).end();
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = path.join(file, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not Found');
    }
  });
  await new Promise((ok, ng) => server.listen(port, '127.0.0.1', ok).on('error', ng));
  srv.stop = () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); });
  return srv;
}

/**
 * ブラウザを立てる。pourfolio.test を自分のPCに向け、http でも安全な場所として扱う（本番と同じく Service Worker が
 * 指紋を確かめる動きになる。localhost では毎回最新のファイルを取るため、更新や古い版の問題が隠れる）
 */
export function launch({ ports = [], args = [] } = {}) {
  // channel 'chromium'（普通の Chromium）でないと、安全な場所として扱う設定が効かない（軽い版の headless shell は無視する）
  return chromium.launch({
    channel: 'chromium',
    args: [
      '--host-resolver-rules=MAP pourfolio.test 127.0.0.1',
      `--unsafely-treat-insecure-origin-as-secure=${ports.map((p) => `http://pourfolio.test:${p}`).join(',')}`,
      ...args,
    ],
  });
}

/** 試すデータ（tests/fixtures/debug/<name>.json）を、開いている画面の保存場所に入れる（load-fixture.js と同じ。ポートの決まりは見ない） */
export async function loadFixture(page, name) {
  return page.evaluate(async (n) => {
    const res = await fetch(`/tests/fixtures/debug/${n}.json`, { cache: 'no-store' });
    const { openDb, clearAll, restoreBackup, countAlive } = await import('/js/db.js');
    const { parseBackup } = await import('/js/core/backup.js');
    const backup = parseBackup(await res.text());
    const db = openDb();
    await clearAll(db);
    await restoreBackup(db, backup);
    const counts = await countAlive(db);
    db.close();
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    return counts;
  }, name);
}

/** 画面のエラーを集める（page.on）。返すのは配列（あとで中身が増える） */
export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`画面のエラー：${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error：${m.text().slice(0, 200)}`); });
  page.on('dialog', (d) => { errors.push(`標準のダイアログ：${d.message().slice(0, 80)}`); d.dismiss().catch(() => {}); });
  return errors;
}

/** 要素を実際に描いたフォントの名前（CDP の CSS.getPlatformFontsForNode）。selector ごとに最初の1つ */
export async function platformFonts(page, selectors) {
  // 見えている最初の要素に印を付けてから調べる（隠れた部品は飛ばす）
  const marks = await page.evaluate((sels) => sels.map((sel, i) => {
    const el = [...document.querySelectorAll(sel)].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden' && /\S/.test(e.textContent || e.value || '');
    });
    if (el) el.setAttribute('data-font-probe', String(i));
    return !!el;
  }), selectors);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const out = {};
  for (const sel of selectors) {
    const i = selectors.indexOf(sel);
    if (!marks[i]) continue;
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-font-probe="${i}"]` }).catch(() => ({ nodeId: 0 }));
    if (!nodeId) continue;
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId }).catch(() => ({ fonts: [] }));
    // 漢字・かなを描いたフォント（グリフ数の多いもの）を先に
    out[sel] = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount).map((f) => f.familyName);
  }
  await cdp.detach();
  return out;
}

/** 中国語用の字形のフォントか（名前で見分ける） */
export const isChineseFont = (name) => /\b(SC|TC|HK|CN|TW)\b|WenQuanYi|文泉|Hei SC|PingFang|Microsoft YaHei|SimSun|SimHei|Source Han Sans (SC|TC|CN)|Droid Sans Fallback|AR PL/i.test(name);
