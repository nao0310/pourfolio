// 点検（キーボード）：入力欄にカーソルを入れてキーボードが出たとき、その欄が見える所にあるかを数える（3.6.3 D-185、3.6.4 D-186）。アプリには含めない。
// 使い方：node scripts/debug/keyboard.js [--mode=safari|app|pc] [画面の名前の始め…]   （--mode を省くと3つとも）
// Chromium ではキーボードが出ないので、visualViewport を作り物に置き換えてまねる：
// - safari：iPhone の Safari。画面（レイアウト）の高さはそのままで、見える範囲だけが KB_PX 狭くなる
// - app：ホーム画面のアプリ。見える範囲は変わらない（iPhone がキーボードの高さを伝えない）が、画面の下 APP_HIDDEN がキーボードで隠れる
//   （ユーザーの画面写真では、かなのキーボードと上の「^ v ✓」の帯で45%）
// - pc：PC（マウス）。キーボードは出ない。下に付けるボタンに隠れないかと、勝手に動かないかだけを見る
// 1つの欄ごとに：中身（main）をスクロールしてその欄を画面の下の端に置く → カーソルを入れる（ブラウザ自身のスクロールは止める）
// → キーボードを出す → 欄が隠れずに見えるか（下に付けるボタンにも隠れないか）を見る。
// 副作用の見張り：
// - 動かない：上のほうに見えている欄を押したとき、中身が動かない（勝手に跳ねない）
// - 見込みを使わない：app で、選ぶ欄・日付・時刻（欄の近くに部品が出るだけ）を押したとき、中身を見込みで動かさない
// 最後に、キーボードを閉じたあとに下のタブが画面のいちばん下にあり、ページ全体がずれていないかを見る。
// Safari そのものの動き（Safari が自分でページをずらす）はまねていない。そこは docs/iphone-check-3-6-4.md で確かめる。
import { startServer, launch, loadFixture, collectErrors } from './pw-lib.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { devices } = require('playwright');
const PORT = 8093;
const KB_PX = 336; // safari：iPhone 13 の日本語キーボード（予測変換の段を含む）のおおよその高さ
const APP_HIDDEN = 0.47; // app：キーボードで隠れる画面の割合（画面写真の45%より少し厳しく）
const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith('--mode='))?.slice(7);
const MODES = modeArg ? modeArg.split(',') : ['safari', 'app', 'pc'];
const only = args.filter((a) => !a.startsWith('--'));

// visualViewport の作り物。mode が app のときは、キーボードを出しても見える範囲を変えない（iPhone が伝えない）
const FAKE_VV = (mode) => {
  let kb = 0;
  const vv = new EventTarget();
  const num = (f) => ({ get: f, configurable: true });
  const shrink = () => (mode === 'safari' ? kb : 0);
  Object.defineProperties(vv, {
    width: num(() => innerWidth),
    height: num(() => innerHeight - shrink()),
    offsetTop: num(() => 0),
    offsetLeft: num(() => 0),
    pageTop: num(() => scrollY),
    pageLeft: num(() => scrollX),
    scale: num(() => 1),
  });
  Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
  window.__kbHidden = () => kb; // 本当にキーボードで隠れている高さ
  window.__kb = (h) => {
    kb = h;
    if (mode === 'safari') vv.dispatchEvent(new Event('resize'));
  };
};

const CONTEXTS = {
  safari: () => ({ ...devices['iPhone 13'] }),
  // ホーム画面のアプリはアドレスの欄がないので、画面の高さが大きい
  app: () => ({ ...devices['iPhone 13'], viewport: { width: 390, height: 800 } }),
  pc: () => ({ viewport: { width: 1280, height: 800 } }),
};
const kbFor = (mode, h) => (mode === 'safari' ? KB_PX : mode === 'app' ? Math.round(h * APP_HIDDEN) : 0);

const srv = await startServer(PORT);
const browser = await launch({ ports: [PORT] });
const errors = [];
let total = 0;
let bad = 0;
const lines = [];

for (const mode of MODES) {
  const ctxOpts = CONTEXTS[mode]();
  delete ctxOpts.defaultBrowserType;
  const context = await browser.newContext({ ...ctxOpts, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await context.addInitScript(FAKE_VV, mode);
  const page = await context.newPage();
  errors.push(...collectErrors(page));
  const pageErrors = collectErrors(page);
  await page.goto(`${srv.base}/more.html`);
  await loadFixture(page, 'demo');
  const H = await page.evaluate(() => innerHeight);
  const KB = kbFor(mode, H);

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
    'brew.html（実績の確認）', 'wishlist.html', 'order-import.html', `ai.html?bean=${ids.bean}`, 'weather.html', 'shops.html', 'more.html', 'today.html', 'data.html',
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

  /**
   * n番目の欄を置いてからカーソルを入れ、キーボードを出して、見えるかを返す。
   * place：'bottom'（画面の下の端）・'end'（いちばん下までスクロール）・'top'（上のほうの見えている所。動かないことを見る）
   */
  const tryField = async (n, place) => {
    const before = await page.evaluate(({ n, place }) => {
      const el = document.querySelector(`[data-kb-check="${n}"]`);
      const main = document.querySelector('main');
      const m = main.getBoundingClientRect();
      if (place === 'end') main.scrollTop = main.scrollHeight;
      else if (place === 'top') main.scrollTop += el.getBoundingClientRect().top - (m.top + 120);
      else main.scrollTop += el.getBoundingClientRect().bottom - (m.bottom - 8);
      const r = el.getBoundingClientRect();
      el.focus({ preventScroll: true });
      return { scrollTop: main.scrollTop, top: r.top, bottom: r.bottom };
    }, { n, place });
    await page.waitForTimeout(30);
    await page.evaluate((h) => window.__kb(h), KB);
    await page.waitForTimeout(600);
    const res = await page.evaluate(async (n) => {
      const el = document.querySelector(`[data-kb-check="${n}"]`);
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const top = vv.offsetTop;
      const bottom = Math.min(vv.offsetTop + vv.height, innerHeight - window.__kbHidden());
      let bar = null;
      for (const b of document.querySelectorAll('.bottom-bar')) {
        const br = b.getBoundingClientRect();
        if (!br.height || b.contains(el)) continue;
        if (br.top < Math.min(r.bottom, bottom) && br.bottom > r.top) bar = Math.round(br.top);
      }
      const { keyboardState = {} } = await import('/js/layout.js'); // 3.6.3 以前には keyboardState がない
      const name = el.name || el.id || el.getAttribute('aria-label') || el.tagName.toLowerCase();
      const hidden = r.bottom > bottom + 0.5 || r.top < top - 0.5 || bar != null;
      const popover = el.tagName === 'SELECT' || ['date', 'time', 'datetime-local', 'month', 'week'].includes(el.type);
      return {
        name, hidden, popover, guessed: keyboardState.guessed, scrollTop: document.querySelector('main').scrollTop,
        rect: [Math.round(r.top), Math.round(r.bottom)], visible: [Math.round(top), Math.round(bottom)], bar, focused: document.activeElement === el,
      };
    }, n);
    res.moved = Math.round(res.scrollTop - before.scrollTop);
    res.before = before;
    // キーボードを閉じる
    await page.evaluate(() => document.activeElement?.blur());
    await page.evaluate(() => window.__kb(0));
    await page.waitForTimeout(150);
    return res;
  };

  const tabbarOk = () => page.evaluate(() => {
    const t = document.querySelector('nav.tabbar')?.getBoundingClientRect();
    const main = document.querySelector('main');
    return { ok: !t || (Math.round(innerHeight - t.bottom) === 0 && scrollY === 0), off: t ? Math.round(innerHeight - t.bottom) : null, scrollY, kbOpen: main?.classList.contains('kb-open') };
  });

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

  const desc = (r) => `${r.name}（欄 ${r.rect.join('〜')}、見える範囲 ${r.visible.join('〜')}${r.bar != null ? `、下のボタン ${r.bar}` : ''}${r.focused ? '' : '、カーソルが外れた'}${r.guessed ? '、見込み' : ''}、動いた ${r.moved}px）`;
  lines.push(`\n## ${mode}（画面の高さ ${H}px、キーボード ${KB}px）`);
  let modeBad = 0;
  for (const u of PAGES) {
    if (u.includes('（実績の確認）')) await openBrewResult();
    else await page.goto(`${srv.base}/${u}`);
    await page.waitForLoadState('load');
    // 画面が遅れて描き足す部品（前回の申し送りなど）で中身の位置が変わるのを待つ（待ちが短いと「見えているのに動いた」と数えてしまう）
    await page.waitForTimeout(1500);
    const n = await mark();
    const found = [];
    const notes = [];
    for (let i = 0; i < n; i++) {
      // 1. 画面の下の端の欄
      const r = await tryField(i, 'bottom');
      total++;
      // app の選ぶ欄・日付・時刻：iPhone では文字盤が出ず、欄の近くに部品が出る（下から回転式の部品が出ても、選んでいる値はその部品に出る）ので、
      // 見込みで動かさない。隠れたかは参考として数える
      if (mode === 'app' && r.popover && r.hidden) notes.push(r.name);
      else if (r.hidden || !r.focused) found.push(`隠れた：${desc(r)}`);
      // 選ぶ欄・日付・時刻は見込みで動かさない。safari は本当の高さが分かるので見込みを使わない。pc は見込みを使わない
      if (r.guessed && (r.popover || mode !== 'app')) found.push(`見込みを使った：${desc(r)}`);
      // 2. 上のほうに見えている欄は動かない（置けたときだけ）
      const t = await tryField(i, 'top');
      total++;
      const roomBottom = (mode === 'safari' ? H - KB : mode === 'app' ? Math.round(H / 2) : H) - 40;
      if (t.before.top >= 80 && t.before.bottom <= roomBottom && t.moved !== 0) found.push(`見えているのに動いた：${desc(t)}`);
    }
    if (n) {
      const r = await tryField(n - 1, 'end');
      total++;
      if (mode === 'app' && r.popover && r.hidden) notes.push(`いちばん下の ${r.name}`);
      else if (r.hidden || !r.focused) found.push(`いちばん下までスクロールして隠れた：${desc(r)}`);
    }
    const tab = await tabbarOk();
    const issues = found.length + (tab.ok && !tab.kbOpen ? 0 : 1);
    modeBad += issues;
    lines.push(`${issues ? '×' : '○'} ${u.replace(/=[0-9a-f-]{36}/g, '=…')}：欄 ${n}、見つかった ${found.length}${tab.ok && !tab.kbOpen ? '' : `、キーボードを閉じたあと ${JSON.stringify(tab)}`}`);
    for (const h of found) lines.push(`    - ${h}`);
    if (notes.length) lines.push(`    （参考）キーボードの出ない欄で、見込みで動かさなかったもの ${notes.length}：${notes.join('、')}`);
  }
  lines.push(`（${mode} で見つかった：${modeBad}）`);
  bad += modeBad;
  errors.push(...pageErrors);
  await context.close();
}
console.log(lines.join('\n'));
console.log(`\n合計：試した ${total}、見つかった ${bad}${errors.length ? `\n画面のエラー：\n${[...new Set(errors)].join('\n')}` : ''}`);
await browser.close();
await srv.stop?.();
process.exit(bad ? 1 : 0);
