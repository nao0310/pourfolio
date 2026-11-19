// 総仕上げ：漢字が日本語の字形で描かれているかを確かめる。アプリには含めない。
// 使い方：node scripts/debug/glyphs.js [出力フォルダ]
//   ブラウザの言語を ja-JP・en-US・zh-CN にして画面を開き、
//   ① 見出し・ボタン・入力欄・select・下のタブ・SVGの文字を描いたフォントの名前（CDP）
//   ② 見本の文字（直 骨 角 写 今 …）の画面写真
//   ③ canvas（抽出レポート・年間まとめの画像と同じ描き方）が日本語用・中国語用のどちらのフォントと同じ形か
//   を出す。中国語用のフォント（名前に SC・TC・WenQuanYi など）が選ばれたら「NG」。
// 中国語用のフォントが入っていない端末では差が出ないので、確かめる端末に Noto Sans CJK JP と SC の両方を入れておく。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, startServer, platformFonts, isChineseFont } from './pw-lib.js';

const OUT = path.resolve(process.argv[2] ?? 'glyphs-out');
const LOCALES = ['ja-JP', 'en-US', 'zh-CN'];
// この作業環境に入っている日本語用・中国語用のフォント（canvas の形を比べる相手）
const JP_FONTS = ['Noto Sans CJK JP', 'IPAGothic', 'IPAPGothic'];
const CN_FONTS = ['Noto Sans CJK SC', 'Noto Sans CJK TC', 'WenQuanYi Zen Hei'];  // 空白は別のフォントで描かれて幅がずれるので、比べる文字は空白を抜く
export const SAMPLE = '直 骨 角 写 今 化 次 着 浅 器 曜 歳';
const PAGES = [
  { page: 'more.html', sels: ['h1', '.tabbar a', 'a.btn', 'main p'] },
  { page: 'bean-edit.html', sels: ['input[type=text]', 'select', 'textarea', 'button', 'label'] },
  { page: 'analysis.html?demo=1', sels: ['svg text', 'h2'] },
];

export async function run({ base, outDir = OUT, shots = true } = {}) {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const rows = [];
  for (const locale of LOCALES) {
    const ctx = await browser.newContext({ locale, viewport: { width: 375, height: 700 } });
    const page = await ctx.newPage();
    for (const { page: p, sels } of PAGES) {
      await page.goto(`${base}/${p}`);
      await page.waitForTimeout(900);
      const fonts = await platformFonts(page, sels);
      for (const [sel, names] of Object.entries(fonts)) {
        rows.push({ locale, page: p, sel, font: names[0] ?? '-', ok: !isChineseFont(names[0] ?? '') });
      }
    }
    // 見本の文字：本文・ボタン・入力欄で（画面の font-family をそのまま受け継ぐ）
    await page.goto(`${base}/more.html`);
    await page.waitForTimeout(600);
    await page.evaluate((s) => {
      const box = document.createElement('div');
      box.id = 'glyph-sample';
      box.style.cssText = 'position:fixed;left:0;top:0;right:0;z-index:99999;background:var(--bg);padding:12px;';
      box.innerHTML = `<p style="font-size:34px;margin:0">${s}</p><button class="btn" style="font-size:22px">${s}</button>
        <input type="text" value="${s}" style="font-size:22px;width:100%"><select style="font-size:22px"><option>${s}</option></select>`;
      document.body.appendChild(box);
    }, SAMPLE);
    const fonts = await platformFonts(page, ['#glyph-sample p', '#glyph-sample button', '#glyph-sample input', '#glyph-sample select']);
    for (const [sel, names] of Object.entries(fonts)) rows.push({ locale, page: '見本', sel, font: names[0] ?? '-', ok: !isChineseFont(names[0] ?? '') });
    if (shots) await page.locator('#glyph-sample').screenshot({ path: path.join(outDir, `sample-${locale}.png`) });
    // canvas：アプリの描き方（brew-image.js の text）で描いたものが、JP・SC のどちらと同じ形か
    const cv = await page.evaluate(async ([s, JP, CN]) => {
      const m = await import('/js/brew-image.js');
      const draw = (fn) => {
        const c = document.createElement('canvas');
        c.width = 900;
        c.height = 90;
        const x = c.getContext('2d');
        fn(x);
        return c.toDataURL();
      };
      const app = draw((x) => {
        if (m.setJa) m.setJa(x);
        m.text(x, s, 10, 64, { px: 56 });
      });
      const as = (fam) => draw((x) => {
        x.font = `400 56px "${fam}"`;
        x.fillStyle = m.C.fg;
        x.fillText(s, 10, 64);
      });
      const same = {};
      for (const fam of [...JP, ...CN]) same[fam] = as(fam) === app;
      return { app, same, lang: 'lang' in CanvasRenderingContext2D.prototype };
    }, [SAMPLE.replace(/ /g, ''), JP_FONTS, CN_FONTS]);
    const hit = Object.entries(cv.same).find(([, v]) => v)?.[0];
    rows.push({ locale, page: 'canvas', sel: `brew-image.js の text（ctx.lang ${cv.lang ? 'が使える' : 'が使えない'}）`, font: hit ? `${hit} と同じ形` : 'どれとも違う形', ok: !!hit && JP_FONTS.includes(hit) });
    if (shots) await writeFile(path.join(outDir, `canvas-${locale}.png`), Buffer.from(cv.app.split(',')[1], 'base64'));
    await ctx.close();
  }
  await browser.close();
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const srv = await startServer(8090);
  try {
    const rows = await run({ base: srv.base });
    console.log('| 言語 | 画面 | 部品 | 描いたフォント | 結果 |\n| --- | --- | --- | --- | --- |');
    for (const r of rows) console.log(`| ${r.locale} | ${r.page} | ${r.sel} | ${r.font} | ${r.ok ? 'OK' : 'NG'} |`);
    console.log(`\nNG ${rows.filter((r) => !r.ok).length}件 / ${rows.length}件。画面写真：${OUT}`);
  } finally {
    srv.stop();
  }
}
