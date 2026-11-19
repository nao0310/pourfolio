// 点検（キーボード）：入力欄にカーソルを入れてキーボードが出たとき、その欄が見える所にあるかを数える（3.6.3、D-185）。アプリには含めない。
// 使い方：node scripts/debug/keyboard.js [画面の名前の始め…]   （例：node scripts/debug/keyboard.js bean-edit tasting）
// iPhone の Safari はキーボードを出しても画面（レイアウト）の高さを変えず、見える範囲（visualViewport）だけを狭くする。
// Chromium ではキーボードが出ないので、visualViewport を作り物に置き換えて、見える範囲だけを KB_PX 狭くしてまねる。
// 1つの欄ごとに：中身（main）をスクロールしてその欄を画面の下の端に置く → カーソルを入れる（ブラウザ自身のスクロールは止める）
// → キーボードを出す → 欄（見出しを含む）が見える範囲にあり、下に付けるボタンにも隠れていないかを見る。
// 最後に、キーボードを閉じたあとに下のタブが画面のいちばん下にあり、ページ全体がずれていないかを見る。
// Safari そのものの動き（Safari が自分でページをずらす）はまねていない。そこは docs/iphone-check-3-6-3.md で確かめる。
import { startServer, launch, loadFixture, collectErrors } from './pw-lib.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { devices } = require('playwright');
const PORT = 8093;
const KB_PX = 336; // iPhone 13 の日本語キーボード（予測変換の段を含む）のおおよその高さ
const only = process.argv.slice(2);

const FAKE_VV = () => {
  let kb = 0;
  const vv = new EventTarget();
  const num = (f) => ({ get: f, configurable: true });
  Object.defineProperties(vv, {
    width: num(() => innerWidth),
    height: num(() => innerHeight - kb),
    offsetTop: num(() => 0),
    offsetLeft: num(() => 0),
    pageTop: num(() => scrollY),
    pageLeft: num(() => scrollX),
    scale: num(() => 1),
  });
  Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
  window.__kb = (h) => { kb = h; vv.dispatchEvent(new Event('resize')); };
};

const srv = await startServer(PORT);
const browser = await launch({ ports: [PORT] });
const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
await context.addInitScript(FAKE_VV);
const page = await context.newPage();
const errors = collectErrors(page);
await page.goto(`${srv.base}/more.html`);
await loadFixture(page, 'demo');

const ids = await page.evaluate(async () => {
  const m = await import('/js/db.js');
  const d = m.openDb();
  const all = await m.readAll(d);
  d.close();
  const alive = (t) => (all[t] ?? []).filter((r) => r.deletedAt == null);
  const newest = (rows, k = 'updatedAt') => [...rows].sort((a, b) => String(b[k]).localeCompare(String(a[k])))[0];
  return {
    bean: (newest(alive('beans').filter((b) => b.status !== 'finished')) ?? newest(alive('beans')))?.id,
    recipe: newest(alive('recipes'))?.id,
    brew: newest(alive('brews'), 'at')?.id,
    eq: newest(alive('equipment'))?.id,
  };
});

const PAGES = [
  'bean-edit.html', `bean-edit.html?id=${ids.bean}`, `bean.html?id=${ids.bean}`,
  `recipe-edit.html?id=${ids.recipe}`, 'recipe-edit.html', `equipment-edit.html?id=${ids.eq}`,
  `tasting.html?brew=${ids.brew}`, `brew.html?brew=${ids.brew}`, `brew.html?bean=${ids.bean}`,
  'brew.html（実績の確認）', 'wishlist.html', 'order-import.html', `ai.html?bean=${ids.bean}`, 'weather.html', 'shops.html', 'more.html', 'today.html',
].filter((u) => !only.length || only.some((n) => u.startsWith(n)));

/** 画面の中の、見えている入力欄に番号を付けて数を返す（閉じた「くわしく」は開く） */
const mark = () => page.evaluate(() => {
  for (const d of document.querySelectorAll('main details')) d.open = true;
  const sel = 'main input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]):not([type=hidden]), main textarea, main select';
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.disabled || el.readOnly || getComputedStyle(el).visibility === 'hidden') continue;
    el.dataset.kbCheck = String(n++);
  }
  return n;
});

/** n番目の欄を画面の下の端に置いてからカーソルを入れ、キーボードを出して、見えるかを返す */
const tryField = async (n, atBottom) => {
  await page.evaluate(({ n, atBottom }) => {
    const el = document.querySelector(`[data-kb-check="${n}"]`);
    const main = document.querySelector('main');
    if (atBottom) main.scrollTop = main.scrollHeight;
    else {
      const m = main.getBoundingClientRect();
      main.scrollTop += el.getBoundingClientRect().bottom - (m.bottom - 8);
    }
    el.focus({ preventScroll: true });
  }, { n, atBottom });
  await page.waitForTimeout(30);
  await page.evaluate((h) => window.__kb(h), KB_PX);
  await page.waitForTimeout(450);
  const res = await page.evaluate((n) => {
    const el = document.querySelector(`[data-kb-check="${n}"]`);
    const r = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const top = vv.offsetTop;
    const bottom = vv.offsetTop + vv.height;
    let bar = null;
    for (const b of document.querySelectorAll('.bottom-bar')) {
      const br = b.getBoundingClientRect();
      if (!br.height || b.contains(el)) continue;
      if (br.top < Math.min(r.bottom, bottom) && br.bottom > r.top) bar = Math.round(br.top);
    }
    const name = el.name || el.id || el.getAttribute('aria-label') || el.tagName.toLowerCase();
    const hidden = r.bottom > bottom + 0.5 || r.top < top - 0.5 || bar != null;
    return { name, hidden, rect: [Math.round(r.top), Math.round(r.bottom)], visible: [Math.round(top), Math.round(bottom)], bar, focused: document.activeElement === el };
  }, n);
  // キーボードを閉じる
  await page.evaluate(() => document.activeElement?.blur());
  await page.evaluate(() => window.__kb(0));
  await page.waitForTimeout(150);
  return res;
};

const tabbarOk = () => page.evaluate(() => {
  const t = document.querySelector('nav.tabbar')?.getBoundingClientRect();
  return { ok: !t || (Math.round(innerHeight - t.bottom) === 0 && scrollY === 0), off: t ? Math.round(innerHeight - t.bottom) : null, scrollY };
});

let total = 0;
let bad = 0;
const lines = [];
/** 淹れる画面の「実績の確認」まで進める（時計を早送りして注湯完了を押していく） */
async function openBrewResult() {
  await page.clock.install();
  await page.goto(`${srv.base}/brew.html?recipe=${ids.recipe}`);
  await page.waitForSelector('#start:visible');
  await page.click('#start');
  await page.waitForSelector('#timerView:not([hidden])');
  for (let i = 0; i < 30 && !(await page.locator('#resultView:not([hidden])').count()); i++) {
    await page.clock.runFor(15000);
    await page.click('#tap', { force: true });
  }
  await page.clock.resume();
  await page.waitForSelector('#resultView:not([hidden])');
}

for (const u of PAGES) {
  if (u.includes('（実績の確認）')) await openBrewResult();
  else await page.goto(`${srv.base}/${u}`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(700);
  const n = await mark();
  const hidden = [];
  for (let i = 0; i < n; i++) {
    const r = await tryField(i, false);
    total++;
    if (r.hidden || !r.focused) hidden.push(`${r.name}（欄 ${r.rect.join('〜')}、見える範囲 ${r.visible.join('〜')}${r.bar != null ? `、下のボタン ${r.bar}` : ''}${r.focused ? '' : '、カーソルが外れた'}）`);
  }
  // いちばん下までスクロールしてから、いちばん下の欄
  if (n) {
    const r = await tryField(n - 1, true);
    total++;
    if (r.hidden || !r.focused) hidden.push(`いちばん下までスクロールして ${r.name}（欄 ${r.rect.join('〜')}、見える範囲 ${r.visible.join('〜')}${r.bar != null ? `、下のボタン ${r.bar}` : ''}）`);
  }
  const tab = await tabbarOk();
  bad += hidden.length + (tab.ok ? 0 : 1);
  lines.push(`${hidden.length || !tab.ok ? '×' : '○'} ${u.replace(/=[0-9a-f-]{36}/g, '=…')}：欄 ${n}、隠れた ${hidden.length}${tab.ok ? '' : `、キーボードを閉じたあと下のタブがずれた ${JSON.stringify(tab)}`}`);
  for (const h of hidden) lines.push(`    - ${h}`);
}
console.log(lines.join('\n'));
console.log(`\n合計：試した ${total}、隠れた・ずれた ${bad}${errors.length ? `\n画面のエラー：\n${[...new Set(errors)].join('\n')}` : ''}`);
await browser.close();
await srv.close?.();
process.exit(bad ? 1 : 0);
