// 総仕上げ（3-6 のあと）：Playwright で点検するときの共通部品。アプリには含めない（scripts/ は sw.js の一覧に入らない）。
// Node から使う（node scripts/debug/glyphs.js など）。Browserペインの道具（audit.js など）はそのまま page.evaluate で使う。
// ブラウザは毎回まっさらなプロファイル（newContext）で開くので、作業用のブラウザの記憶やキャッシュで問題が隠れない。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

/** 点検用のサーバーを立てる（8082〜8099）。終わったら stop() */
export async function startServer(port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/debug/serve.js'), String(port)], { stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/index.html`);
      if (r.ok) return { base, stop: () => child.kill() };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`サーバーが立ち上がりません（${port}）`);
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
