// 総点検（流れ）：豆と在庫まわりの画面を、操作のあとに壊れないか確かめる。アプリには含めない（scripts/ は sw.js の一覧に入らない）。
// 使い方：node scripts/debug/flows-beans.js [流れの名前…]
//   名前を省くと全部。結果は標準出力に「○ / ×」と、見つけたこと（画面のエラー・データのつじつま・数字）を出す。
// 試すこと：豆の登録 → 編集 → 削除、在庫の操作（冷凍する・届いた・1杯淹れた・量り直す・減らす・取り出す・おすそ分け・
//   飲み切り）の2度押し・連打、残り0g・マイナス、とても長い名前、保存・削除のあとのブラウザの「戻る」（古い画面が出るか）、
//   確認の箱（標準の confirm が出ないこと）、レシピ・器具・気になる豆・注文メール。
// 毎回まっさらなプロファイル（iPhone 13・ja-JP・Asia/Tokyo）。ポートは 8092。
// 「戻る」は本物の iPhone に近づけるため bfcache を有効にして試す（Playwright は既定で止めている。下の launch を参照）。
// 「（参考）」の行は、決まりどおりかもしれないので見て判断するもの。それ以外の行が見つけたこと。
import { startServer, chromium, loadFixture, collectErrors } from './pw-lib.js';
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { devices } = require('playwright');
const PORT = 8092;
const only = process.argv.slice(2);
const results = [];

// 本番（GitHub Pages）は no-store を付けないので、ブラウザが「戻る」で前の画面をそのまま見せる（bfcache）。
// 点検のサーバーは no-store を付けて bfcache を止めるので、BFCACHE が true の間だけ no-cache に置き換える
let BFCACHE = false;
const writeHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (code, headers) {
  if (BFCACHE && headers?.['Cache-Control'] === 'no-store') headers = { ...headers, 'Cache-Control': 'no-cache' };
  return writeHead.call(this, code, headers);
};
const srv = await startServer(PORT);
// pw-lib の launch と同じ設定に加え、Playwright が既定で止めている bfcache（「戻る」で前の画面をそのまま出す）を有効にする。
// iPhone の Safari は bfcache を使うので、こちらのほうが本物に近い
const browser = await chromium.launch({
  channel: 'chromium',
  ignoreDefaultArgs: ['--disable-back-forward-cache'],
  args: ['--host-resolver-rules=MAP pourfolio.test 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=http://pourfolio.test:${PORT}`],
});

async function fresh(fixture = 'empty', ctx = {}) {
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP', timezoneId: 'Asia/Tokyo', ...ctx });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(`${srv.base}/more.html`);
  if (fixture) await loadFixture(page, fixture);
  return { context, page, errors };
}

const consistency = (page) =>
  page.evaluate(async () => (await (await import('/scripts/debug/consistency.js')).checkBrowser()).filter((p) => p.level === '問題').map((p) => `${p.table} ${p.text}`));

/** DB を直接読む（画面ではなく記録で確かめる） */
const dbRead = (page, fn) =>
  page.evaluate(async (src) => {
    const m = await import('/js/db.js');
    const db = m.openDb();
    const all = await m.readAll(db);
    db.close();
    return new Function('all', `return (${src})(all)`)(all);
  }, fn.toString());

const remainOf = (page, beanId) =>
  dbRead(page, `(all) => Math.round(all.inventoryTx.filter((t) => t.beanId === ${JSON.stringify(beanId)} && t.deletedAt == null).reduce((s, t) => s + t.deltaG, 0) * 10) / 10`);

/** ブラウザの「戻る」。bfcache から出たときは load が来ないので commit まで待つ */
async function back(page) {
  await page.goBack({ waitUntil: 'commit' });
  await page.waitForTimeout(600);
}

async function settle(page) {
  await page.waitForLoadState('load');
  await page.waitForTimeout(400);
}

/** 豆の画面の「量り直す」「おすそ分け・廃棄」を開く */
async function openSub(page, label) {
  await page.evaluate((l) => {
    for (const d of document.querySelectorAll('details')) if (d.querySelector('summary')?.textContent.includes(l)) d.open = true;
  }, label);
}

/** 廃棄を選ぶ（丸いボタンは隠れているので札を押す） */
async function chooseDiscard(page) {
  await openSub(page, 'おすそ分け');
  await page.locator('label.chip', { hasText: '廃棄' }).click();
}

/** 確認の箱（dialog.confirm-box）の進むボタンを押す */
async function confirmYes(page) {
  const box = page.locator('dialog.confirm-box');
  await box.waitFor({ timeout: 3000 });
  // 確認の箱は開いてから0.4秒はタップを受け付けない（2度押しの2回目を無視する、総仕上げの67番）。人と同じく読んでから押す
  await page.waitForTimeout(500);
  await box.locator('button').last().click();
}

async function flow(name, fixture, fn, { bfcache = false, ctx = {} } = {}) {
  if (only.length && !only.includes(name)) return;
  BFCACHE = bfcache;
  const { context, page, errors } = await fresh(fixture, ctx);
  const notes = [];
  try {
    await fn(page, notes);
    const c = await consistency(page);
    if (c.length) notes.push(`つじつま：${c.join(' / ')}`);
  } catch (err) {
    notes.push(`止まった：${err.message.split('\n').slice(0, 3).join(' ')}`);
  }
  notes.push(...errors.filter((e) => !e.includes('わざと')));
  results.push({ name, notes });
  console.log(`${notes.length ? '×' : '○'} ${name}`);
  for (const n of notes) console.log(`    ${n}`);
  await context.close();
}

/** 手で豆を登録する（実重量あり・未開封） */
async function registerBean(page, { name = 'テスト豆', actual = '200', status = 'unopened', roast = '中深煎り' } = {}) {
  await page.goto(`${srv.base}/bean-edit.html`);
  await settle(page);
  await page.fill('[name=name]', name);
  await page.selectOption('[name=roastLevel]', roast).catch(() => {});
  if (actual) await page.fill('[name=actualWeightG]', actual);
  await page.evaluate((s) => {
    const f = document.querySelector('form');
    const el = f.elements.status;
    if (el instanceof RadioNodeList) [...el].forEach((r) => (r.checked = r.value === s));
    else el.value = s;
  }, status);
  await page.click('#save');
  await page.waitForURL(/bean\.html\?id=/);
  await settle(page);
  return new URL(page.url()).searchParams.get('id');
}

// ---------------- 流れ ----------------

// 1. 登録 → 在庫の操作の2度押し（どれも1件だけできるか）
await flow('在庫の2度押し', 'empty', async (page, notes) => {
  const id = await registerBean(page);
  const before = await dbRead(page, '(all) => all.inventoryTx.length');
  // 1杯淹れた（dblclick と、続けて2回の click）
  await page.locator('#cupForm button[type=submit]').dblclick();
  await page.waitForTimeout(800);
  await openSub(page, '量り直す');
  await page.fill('#measured', '150');
  // 同じ瞬間に2回（指が2回当たったとき）
  await page.evaluate(() => {
    const b = document.querySelector('#measureForm button[type=submit]');
    b.click();
    b.click();
  });
  await page.waitForTimeout(800);
  await chooseDiscard(page);
  await page.fill('#outG', '5');
  await page.locator('#outForm button[type=submit]').dblclick();
  await page.waitForTimeout(800);
  const after = await dbRead(page, '(all) => all.inventoryTx.map((t) => t.kind)');
  const added = after.length - before;
  if (added !== 3) notes.push(`3件のはずが ${added}件（${after.join(',')}）`);
  const r = await remainOf(page, id);
  if (r !== 145) notes.push(`残りが ${r}g（145g のはず）`);
  const shown = await page.textContent('#remain');
  if (!shown.includes('145')) notes.push(`画面の残り：${shown}`);
});

// 2. 飲み切りにする を2度押し（2回目が「取り消す」になって戻らないか）
await flow('飲み切りの2度押し', 'empty', async (page, notes) => {
  const id = await registerBean(page);
  await page.locator('#toggleFinished').dblclick();
  await page.waitForTimeout(1000);
  const st = await dbRead(page, `(all) => all.beans.find((b) => b.id === ${JSON.stringify(id)}).status`);
  if (st !== 'finished') notes.push(`2度押しのあとの状態：${st}（finished のはず）。ボタン：${await page.textContent('#toggleFinished')}`);
  // 素早く3回
  await page.goto(page.url());
  await settle(page);
  const b = page.locator('#toggleFinished');
  await b.click();
  await page.waitForTimeout(30);
  await b.click();
  await page.waitForTimeout(30);
  await b.click();
  await page.waitForTimeout(1000);
  const st2 = await dbRead(page, `(all) => all.beans.find((b) => b.id === ${JSON.stringify(id)}).status`);
  notes.push(`（参考）飲み切りの画面で3回押したあと：${st2}`);
});

// 3. 冷凍 → 取り出す（2度押し）→ 取り出しの取り消し → 冷凍の取り消し
await flow('冷凍と取り出し', 'empty', async (page, notes) => {
  const id = await registerBean(page, { actual: '100' });
  await page.evaluate(() => (document.getElementById('freezeDetails').open = true));
  await page.locator('#fzGrams').fill('15');
  await page.locator('#fzCount').fill('2');
  await page.locator('#freezeForm button[type=submit]').dblclick();
  await page.waitForTimeout(1000);
  const portions = await dbRead(page, '(all) => all.frozenPortions.filter((p) => p.deletedAt == null).length');
  if (portions !== 2) notes.push(`冷凍の袋が ${portions}袋（2袋のはず）`);
  await page.locator('#portionList button').first().dblclick();
  await page.waitForTimeout(1000);
  const fzMsg = (await page.textContent('#fzMsg')) ?? '';
  if (/冷凍庫にない/.test(fzMsg)) notes.push(`取り出しの2度押しでエラー：${fzMsg}`);
  const thaws = await dbRead(page, "(all) => all.inventoryTx.filter((t) => t.kind === 'thaw' && t.deletedAt == null).length");
  if (thaws !== 1) notes.push(`取り出しが ${thaws}件`);
  // 取り出しを取り消す
  await page.locator('#txList li', { hasText: '取り出し' }).locator('button').click();
  await confirmYes(page);
  await page.waitForTimeout(800);
  // 冷凍を取り消す
  await page.locator('#txList li', { hasText: '冷凍' }).first().locator('button').click();
  await confirmYes(page);
  await page.waitForTimeout(800);
  const r = await remainOf(page, id);
  if (r !== 100) notes.push(`冷凍・取り出しを全部取り消したあとの残り ${r}g（100g のはず）`);
  const left = await dbRead(page, '(all) => all.frozenPortions.filter((p) => p.deletedAt == null).length');
  if (left !== 0) notes.push(`冷凍を取り消したのに袋が ${left}袋残る`);
  const shown = await page.textContent('#frozenSummary');
  if (!/ありません/.test(shown)) notes.push(`冷凍の欄：${shown}`);
});

// 4. 残り0g・マイナス（減らす・1杯淹れた・量り直す0）
await flow('残り0とマイナス', 'empty', async (page, notes) => {
  const id = await registerBean(page, { actual: '10' });
  await page.fill('#cupDose', '15');
  await page.locator('#cupForm button[type=submit]').click();
  await page.waitForTimeout(800);
  // 総仕上げの68番：残りより多いときは確認の箱が出る。「いいえ」なら減らない、「減らす」なら減る
  const cupBox = await page.locator('dialog.confirm-box[open]').count();
  if (!cupBox) notes.push('10gの豆で15gの「1杯淹れた」：確認の箱が出ない');
  else {
    await page.locator('dialog.confirm-box[open] button', { hasText: 'いいえ' }).click();
    await page.waitForTimeout(400);
    if ((await remainOf(page, id)) !== 10) notes.push('「いいえ」なのに減った');
    await page.locator('#cupForm button[type=submit]').click();
    await page.waitForTimeout(500);
    await page.locator('dialog.confirm-box[open] button', { hasText: '減らす' }).click();
    await page.waitForTimeout(800);
  }
  const r = await remainOf(page, id);
  const shown = await page.textContent('#remain');
  const cups = await page.textContent('#cups');
  const fc = await page.textContent('#forecast');
  notes.push(`（参考）10gの豆で15gの「1杯淹れた」：確認の箱 ${cupBox ? 'あり' : 'なし'}、記録 ${r}g・画面 ${shown}・${cups}・${fc}`);
  await chooseDiscard(page);
  await page.fill('#outG', '50');
  await page.locator('#outForm button[type=submit]').click();
  await page.waitForTimeout(800);
  const dlg = await page.locator('dialog.confirm-box[open]').count();
  if (dlg) {
    await page.locator('dialog.confirm-box[open] button', { hasText: '減らす' }).click();
    await page.waitForTimeout(800);
  } else notes.push(`残り${r}gで廃棄50g：確認の箱が出ない`);
  notes.push(`（参考）残り${r}gで廃棄50g：確認の箱 ${dlg ? 'あり' : 'なし'}、記録 ${await remainOf(page, id)}g`);
  await openSub(page, '量り直す');
  await page.fill('#measured', '0');
  await page.locator('#measureForm button[type=submit]').click();
  await page.waitForTimeout(800);
  notes.push(`（参考）量り直し0g：${await remainOf(page, id)}g、状態 ${await dbRead(page, `(all) => all.beans.find((b) => b.id === ${JSON.stringify(id)}).status`)}`);
});

// 5. とても長い名前（一覧・豆の画面で横にはみ出さないか）
for (const [label, long] of [
  ['長い名前（日本語）', 'エチオピア イルガチェフェ ゲデブ地区 コチャレ農園 ナチュラル G1 '.repeat(4)],
  ['長い名前（英数字が続く）', 'ETHIOPIA-YIRGACHEFFE-KOCHERE-NATURAL-G1-LOT20261118'],
]) await flow(label, 'empty', async (page, notes) => {
  const id = await registerBean(page, { name: long });
  const stored = await dbRead(page, `(all) => all.beans.find((b) => b.id === ${JSON.stringify(id)}).name.length`);
  notes.push(`（参考）${long.length}文字 → 保存 ${stored}文字`);
  for (const url of [`bean.html?id=${id}`, 'beans.html', `bean-edit.html?id=${id}`, 'shopping.html', 'gift.html']) {
    await page.goto(`${srv.base}/${url}`);
    await settle(page);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) notes.push(`${url}：横に ${over}px はみ出す`);
  }
});

// 6. 豆の編集を保存したあと「戻る」
await flow('編集のあとの戻る', 'empty', async (page, notes) => {
  await page.goto(`${srv.base}/beans.html`);
  await settle(page);
  const id = await registerBean(page, { name: '戻る前の名前' });
  await page.goto(`${srv.base}/beans.html`);
  await settle(page);
  await page.goto(`${srv.base}/bean.html?id=${id}`);
  await settle(page);
  await page.click('#editLink');
  await page.waitForURL(/bean-edit/);
  await settle(page);
  await page.fill('[name=name]', '直したあとの名前');
  await page.click('#save');
  await page.waitForURL(/bean\.html/);
  await settle(page);
  await back(page);
  const where = page.url().replace(srv.base, '');
  const nm = await page.textContent('#name').catch(() => null);
  notes.push(`（参考）保存して「戻る」：${where}、見出し「${nm}」`);
  if (nm && nm.includes('戻る前')) notes.push(`戻ると古い名前が出る：${where}`);
  await back(page);
  const list = await page.textContent('main');
  if (/戻る前の名前/.test(list)) notes.push(`2回戻った一覧（${page.url().replace(srv.base, '')}）に古い名前`);
});

// 7. 豆を削除 → 「戻る」
await flow('削除のあとの戻る', 'empty', async (page, notes) => {
  const id = await registerBean(page, { name: '消す豆' });
  await page.goto(`${srv.base}/beans.html`);
  await settle(page);
  await page.click(`a[href*="${id}"]`);
  await page.waitForURL(/bean\.html/);
  await settle(page);
  await page.click('#delete');
  await confirmYes(page);
  await page.waitForURL(/beans\.html/);
  await settle(page);
  if (/消す豆/.test(await page.textContent('main'))) notes.push('削除したあとの一覧に消した豆が出る');
  await back(page);
  const where = page.url().replace(srv.base, '');
  const txt = await page.textContent('main');
  notes.push(`（参考）削除して「戻る」：${where}`);
  if (/消す豆/.test(txt)) notes.push(`「戻る」で削除した豆が出る：${where}`);
});

/** 「戻る」で前の画面がそのまま出たか（bfcache） */
const restoredFromCache = (page) => page.evaluate(() => window.__mark === 1);
const mark = (page) => page.evaluate(() => (window.__mark = 1));

// 8. 気になる豆の「買った」→ 登録 → 戻る → もう一度「買った」
await flow('気になる豆の買ったと戻る', 'empty', async (page, notes) => {
  await page.goto(`${srv.base}/wishlist.html`);
  await settle(page);
  await page.fill('#form [name=name]', 'ゲイシャ（気になる）');
  await page.click('#save');
  await page.waitForTimeout(800);
  await mark(page);
  notes.push(`（参考）足したあとの一覧：${(await page.textContent('#openList')).slice(0, 60)}`);
  await page.click('#openList a:has-text("買った")');
  await page.waitForURL(/bean-edit/);
  await settle(page);
  await page.fill('[name=labelWeightG]', '200');
  await page.click('#save');
  await page.waitForURL(/bean\.html/);
  await settle(page);
  await back(page);
  const cached = await restoredFromCache(page);
  const stillOpen = await page.locator('#openList a:has-text("買った")').count();
  notes.push(`（参考）戻ると ${cached ? '前の画面のまま（bfcache）' : '読み直し'}、「買った」ボタン ${stillOpen}個`);
  if (stillOpen) {
    await page.click('#openList a:has-text("買った")');
    await page.waitForURL(/bean-edit/);
    await settle(page);
    const msg = await page.textContent('#wishMsg').catch(() => '');
    await page.fill('[name=labelWeightG]', '200');
    await page.click('#save');
    await page.waitForURL(/bean\.html/);
    await settle(page);
    const n = await dbRead(page, "(all) => all.beans.filter((b) => b.deletedAt == null && b.name.includes('ゲイシャ')).length");
    if (n > 1) notes.push(`同じ気になる豆から豆が ${n}件できた（登録画面の知らせ：${msg.slice(0, 40)}…）`);
  }
}, { bfcache: true });

// 9. 注文メール → 登録 → 戻る → もう一度登録（重複の知らせが出るか）
await flow('注文メールの登録と戻る', 'empty', async (page, notes) => {
  const mail = await readFile(new URL('../../tests/fixtures/tonya-order.txt', import.meta.url), 'utf8');
  await page.goto(`${srv.base}/order-import.html`);
  await settle(page);
  await page.fill('#mail', mail);
  await page.click('#read');
  await page.waitForTimeout(800);
  await mark(page);
  await page.click('#save');
  await page.waitForURL(/beans\.html/);
  await settle(page);
  const first = await dbRead(page, '(all) => all.beans.length');
  await back(page);
  const cached = await restoredFromCache(page);
  const dupShown = await page.locator('#dupNote').isVisible().catch(() => false);
  const saveVisible = await page.locator('#save').isVisible().catch(() => false);
  notes.push(`（参考）戻ると ${cached ? '前の画面のまま（bfcache）' : '読み直し'}、登録ボタン ${saveVisible ? '見える' : '見えない'}、重複の知らせ ${dupShown ? 'あり' : 'なし'}`);
  if (saveVisible && !(await page.locator('#save').isDisabled())) {
    await page.click('#save');
    await page.waitForTimeout(300);
    const dlg = await page.locator('dialog.confirm-box').count();
    if (!dlg) {
      await page.waitForURL(/beans\.html/, { timeout: 3000 }).catch(() => {});
      const now = await dbRead(page, '(all) => [all.beans.length, all.orders.length]');
      notes.push(`戻って「入荷待ちとして登録」をもう一度押すと、確かめなしで同じ注文が2回登録される（豆 ${first} → ${now[0]}件、注文 ${now[1]}件）`);
    }
  }
}, { bfcache: true });

// 10. 豆を削除 → 戻る（bfcache）
await flow('削除のあとの戻る（bfcache）', 'empty', async (page, notes) => {
  const id = await registerBean(page, { name: '消す豆' });
  await page.goto(`${srv.base}/beans.html`);
  await settle(page);
  await mark(page);
  await page.click(`a[href*="${id}"]`);
  await page.waitForURL(/bean\.html/);
  await settle(page);
  await page.click('#delete');
  await confirmYes(page);
  await page.waitForURL(/beans\.html/);
  await settle(page);
  await back(page);
  const cached = await restoredFromCache(page);
  const txt = await page.textContent('main');
  notes.push(`（参考）削除して「戻る」：${page.url().replace(srv.base, '')}、${cached ? 'bfcache' : '読み直し'}`);
  if (/消す豆/.test(txt)) notes.push(`「戻る」で出た一覧（${cached ? '前の画面のまま' : '読み直し'}）に削除した豆が出る`);
}, { bfcache: true });

// 11. 豆の画面 → 編集して保存 → 戻る（bfcache）→ 古い画面で操作
await flow('編集のあとの戻る（bfcache）', 'empty', async (page, notes) => {
  await page.goto(`${srv.base}/beans.html`);
  await settle(page);
  const id = await registerBean(page, { name: '前の名前', actual: '200' });
  await mark(page);
  await page.click('#editLink');
  await page.waitForURL(/bean-edit/);
  await settle(page);
  await page.fill('[name=name]', '新しい名前');
  await page.fill('[name=actualWeightG]', '250');
  await page.click('#save');
  await page.waitForURL(/bean\.html/);
  await settle(page);
  await back(page);
  const cached = await restoredFromCache(page);
  const nm = await page.textContent('#name');
  const rem = await page.textContent('#remain');
  notes.push(`（参考）戻ると ${page.url().replace(srv.base, '')}（${cached ? 'bfcache' : '読み直し'}）：見出し「${nm}」残り ${rem}`);
  if (/前の名前/.test(nm) || /200/.test(rem)) notes.push(`保存したあと「戻る」で、直す前の豆の画面（${nm}・${rem}）が出る`);
}, { bfcache: true });

// 12. 店の台帳：2つの店の☆を素早く続けて押す（1つ目のお気に入りが消えないか）
await flow('店のお気に入りの続け押し', 'empty', async (page, notes) => {
  await registerBean(page, { name: '店Aの豆' });
  await page.goto(`${srv.base}/bean-edit.html`);
  await settle(page);
  for (const [n, shop] of [['店Bの豆', '丸山珈琲'], ['店Cの豆', 'ほかの店']]) {
    await page.goto(`${srv.base}/bean-edit.html`);
    await settle(page);
    await page.fill('[name=name]', n);
    await page.fill('[name=actualWeightG]', '100');
    await page.fill('[name=shop]', shop);
    await page.click('#save');
    await page.waitForURL(/bean\.html/);
  }
  await page.goto(`${srv.base}/shops.html`);
  await settle(page);
  const favs = page.locator('.fav-btn');
  const n = await favs.count();
  if (n < 2) return notes.push(`☆が ${n}個しかない`);
  await page.evaluate(() => {
    const b = document.querySelectorAll('.fav-btn');
    b[0].click();
    b[1].click();
  });
  await page.waitForTimeout(1000);
  const saved = await dbRead(page, '(all) => (all.settings[0]?.favoriteShops ?? [])');
  if (saved.length !== 2) notes.push(`2つの店の☆を続けて押すと、お気に入りは ${saved.length}つ（${JSON.stringify(saved)}）。2つのはず`);
  // 同じ☆の2度押し
  await page.goto(`${srv.base}/shops.html`);
  await settle(page);
  await page.evaluate(() => {
    const b = document.querySelectorAll('.fav-btn')[2];
    b.click();
    b.click();
  });
  await page.waitForTimeout(1000);
  const saved2 = await dbRead(page, '(all) => (all.settings[0]?.favoriteShops ?? [])');
  notes.push(`（参考）同じ☆の2度押しのあと：お気に入り ${saved2.length}つ`);
});

// 13. レシピ：作る → 直す → お気に入りの2度押し → 削除 → 戻る
await flow('レシピの登録・編集・削除', 'empty', async (page, notes) => {
  await page.goto(`${srv.base}/recipes.html`);
  await settle(page);
  await mark(page);
  await page.click('#newRecipe');
  await page.waitForURL(/recipe-edit/);
  await settle(page);
  await page.fill('#name', '朝のレシピ');
  await page.locator('#save').dblclick();
  await page.waitForURL(/recipes\.html/);
  await settle(page);
  const n1 = await dbRead(page, '(all) => all.recipes.filter((r) => r.deletedAt == null).length');
  if (n1 !== 1) notes.push(`「保存する」の2度押しでレシピが ${n1}件`);
  await back(page);
  const cached = await restoredFromCache(page);
  const listText = await page.textContent('main');
  notes.push(`（参考）保存して「戻る」：${page.url().replace(srv.base, '')}（${cached ? 'bfcache' : '読み直し'}）`);
  if (/recipes\.html/.test(page.url()) && !/朝のレシピ/.test(listText)) notes.push('保存して「戻る」と、レシピの一覧に作ったレシピが出ない（前の画面のまま）');
  await page.goto(`${srv.base}/recipes.html`);
  await settle(page);
  await page.evaluate(() => {
    const b = document.querySelector('.fav-btn');
    b.click();
    b.click();
  });
  await page.waitForTimeout(800);
  const fav = await dbRead(page, '(all) => all.recipes[0].favorite');
  notes.push(`（参考）レシピの☆の2度押し：favorite=${fav}`);
  const id = await dbRead(page, '(all) => all.recipes[0].id');
  await page.goto(`${srv.base}/recipe-edit.html?id=${id}`);
  await settle(page);
  await page.click('#delete');
  await confirmYes(page);
  await page.waitForURL(/recipes\.html/);
  await settle(page);
  if (/朝のレシピ/.test(await page.textContent('main'))) notes.push('削除したレシピが一覧に出る');
  await page.goto(`${srv.base}/recipe-edit.html?id=${id}`);
  await settle(page);
  notes.push(`（参考）削除したレシピを開く：${await page.textContent('#title')}`);
});

// 14. 器具：2つ登録 → 「いつも使う」の方を削除 → 残った1つがいつも使うになるか（レシピの初期値）
await flow('器具の削除といつも使う', 'empty', async (page, notes) => {
  for (const n of ['ミルA', 'ミルB', 'ミルC']) {
    await page.goto(`${srv.base}/equipment-edit.html?kind=grinder`);
    await settle(page);
    await page.fill('[name=name]', n);
    await page.locator('#save').dblclick();
    await page.waitForURL(/equipment\.html/);
    await settle(page);
  }
  const n = await dbRead(page, "(all) => all.equipment.filter((e) => e.deletedAt == null).length");
  if (n !== 3) notes.push(`「登録する」の2度押しで器具が ${n}件（3件のはず）`);
  const defId = await dbRead(page, '(all) => all.equipment.find((e) => e.isDefault)?.id');
  await page.goto(`${srv.base}/equipment-edit.html?id=${defId}`);
  await settle(page);
  await page.click('#delete');
  await confirmYes(page);
  await page.waitForURL(/equipment\.html/);
  await settle(page);
  const defs = await dbRead(page, '(all) => all.equipment.filter((e) => e.deletedAt == null && e.isDefault).map((e) => e.name)');
  await page.goto(`${srv.base}/recipe-edit.html`);
  await settle(page);
  const sel = await page.$eval('#grinderId', (s) => s.options[s.selectedIndex]?.textContent ?? '');
  notes.push(`（参考）いつも使うミルを削除したあと：いつも使う ${defs.length ? defs.join('・') : 'なし'}、新しいレシピのミル「${sel}」`);
  await back(page);
  await back(page);
  const t = await page.textContent('main').catch(() => '');
  notes.push(`（参考）2回戻る：${page.url().replace(srv.base, '')}${/ミルA/.test(t) && defId ? '（削除したミルAの名前が見える）' : ''}`);
});

// 15. 意地悪のデータ：豆の画面をすべて開き、マイナスの豆・入荷待ちの豆で操作する
await flow('意地悪のデータの豆', 'nasty', async (page, notes) => {
  const beans = await dbRead(page, '(all) => all.beans.map((b) => ({ id: b.id, name: b.name, status: b.status, del: b.deletedAt != null }))');
  for (const b of beans) {
    await page.goto(`${srv.base}/bean.html?id=${b.id}`);
    await settle(page);
    const txt = await page.textContent('body');
    if (/undefined|NaN|読み込み中/.test(txt)) notes.push(`${b.name}：${txt.match(/undefined|NaN|読み込み中/)[0]} が出る`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) notes.push(`${b.name}：横に ${over}px はみ出す`);
  }
  // マイナスの豆で量り直す → 0 に戻るか
  const minus = beans.find((b) => b.name.includes('マイナス'));
  await page.goto(`${srv.base}/bean.html?id=${minus.id}`);
  await settle(page);
  await openSub(page, '量り直す');
  await page.fill('#measured', '30');
  await page.locator('#measureForm button[type=submit]').click();
  await page.waitForTimeout(800);
  const r = await remainOf(page, minus.id);
  if (r !== 30) notes.push(`マイナスの豆を30gに量り直すと ${r}g`);
  // 入荷待ち：下の「届いた」を重さを入れて2度押し
  const ord = beans.find((b) => b.status === 'ordered');
  await page.goto(`${srv.base}/bean.html?id=${ord.id}`);
  await settle(page);
  await page.fill('#arrivalWeight', '180');
  await page.fill('#arrivalForm [name=roastDate]', '2026-11-15');
  await page.locator('#mainAction').dblclick();
  await page.waitForTimeout(1200);
  const ins = await dbRead(page, `(all) => all.inventoryTx.filter((t) => t.beanId === ${JSON.stringify(ord.id)} && t.kind === 'in' && t.deletedAt == null).length`);
  if (ins !== 1) notes.push(`「届いた」の2度押しで入庫が ${ins}件`);
  const st = await dbRead(page, `(all) => all.beans.find((b) => b.id === ${JSON.stringify(ord.id)}).status`);
  notes.push(`（参考）届いたあと：状態 ${st}、画面の残り ${await page.textContent('#remain')}`);
  // 冷凍だけの豆：取り出す → 取り消す
  const fzb = beans.find((b) => b.name.includes('冷凍だけ'));
  await page.goto(`${srv.base}/bean.html?id=${fzb.id}`);
  await settle(page);
  const before = await remainOf(page, fzb.id);
  const pc = await page.locator('#portionList button').count();
  if (pc) {
    await page.locator('#portionList button').first().click();
    await page.waitForTimeout(800);
    const after = await remainOf(page, fzb.id);
    notes.push(`（参考）冷凍だけの豆：取り出しの前 常温${before}g → ${after}g、画面 ${await page.textContent('#remain')}`);
  }
});

// 16. 在庫の履歴で、抽出の記録とつながった「抽出」の行を取り消す
await flow('抽出の行の取り消し', 'minimal', async (page, notes) => {
  const tx = await dbRead(page, "(all) => all.inventoryTx.find((t) => t.brewId && t.deletedAt == null)");
  if (!tx) return notes.push('（参考）抽出とつながった履歴がない');
  await page.goto(`${srv.base}/bean.html?id=${tx.beanId}`);
  await settle(page);
  const row = page.locator('#txList li', { hasText: '抽出' }).first();
  const hasBtn = await row.locator('button').count();
  notes.push(`（参考）抽出の行の「取り消す」：${hasBtn ? 'ある' : 'ない'}`);
  if (hasBtn) {
    await row.locator('button').click();
    await confirmYes(page);
    await page.waitForTimeout(800);
    const brewAlive = await dbRead(page, `(all) => all.brews.find((b) => b.id === ${JSON.stringify(tx.brewId)})?.deletedAt == null`);
    const txAlive = await dbRead(page, `(all) => all.inventoryTx.find((t) => t.id === ${JSON.stringify(tx.id)}).deletedAt == null`);
    if (brewAlive && !txAlive) notes.push(`抽出の記録は残ったまま、在庫の「抽出 ${tx.deltaG}g」だけ取り消せる（残りが粉量ぶん増え、抽出の記録とつじつまが合わなくなる）`);
  }
});

// 17. 大量のデータ：一覧・豆の画面が読み込み中のまま止まらないか、時間
await flow('大量のデータ', 'bulk', async (page, notes) => {
  for (const url of ['beans.html', 'shopping.html', 'shops.html', 'wishlist.html', 'gift.html', 'equipment.html', 'recipes.html']) {
    const t0 = Date.now();
    await page.goto(`${srv.base}/${url}`);
    await settle(page);
    const ms = Date.now() - t0;
    const txt = await page.textContent('body');
    if (/読み込み中|undefined|NaN/.test(txt)) notes.push(`${url}：「${txt.match(/読み込み中|undefined|NaN/)[0]}」が残る`);
    if (ms > 3000) notes.push(`${url}：開くのに ${ms}ms`);
  }
  const id = await dbRead(page, "(all) => all.beans.find((b) => b.status !== 'finished' && b.status !== 'ordered' && b.deletedAt == null)?.id");
  if (id) {
    await page.goto(`${srv.base}/bean.html?id=${id}`);
    await settle(page);
    const t0 = Date.now();
    await page.locator('#cupForm button[type=submit]').click();
    await page.waitForFunction(() => !document.querySelector('#cupForm button[type=submit]').disabled);
    notes.push(`（参考）大量のデータで「1杯淹れた」→ 画面が直るまで ${Date.now() - t0}ms`);
  }
});

// 18. おすそ分け：残りより多く渡す（確認の箱）→ やめる / 進む、感想の2度押し
await flow('おすそ分け', 'empty', async (page, notes) => {
  const id = await registerBean(page, { actual: '20' });
  await openSub(page, 'おすそ分け');
  await page.fill('#giftTo', '母');
  await page.fill('#outG', '50');
  await page.locator('#outForm button[type=submit]').click();
  const box = page.locator('dialog.confirm-box');
  await box.waitFor({ timeout: 3000 });
  await page.waitForTimeout(500); // 開いてすぐのタップは受け付けない（67番）
  await box.locator('button').first().click(); // いいえ
  await page.waitForTimeout(500);
  const disabled = await page.locator('#outForm button[type=submit]').isDisabled();
  if (disabled) notes.push('確認の箱で「いいえ」のあと、ボタンが押せないまま');
  await page.locator('#outForm button[type=submit]').click();
  await confirmYes(page);
  await page.waitForTimeout(800);
  const gifts = await dbRead(page, "(all) => all.inventoryTx.filter((t) => t.kind === 'gift').length");
  if (gifts !== 1) notes.push(`おすそ分けが ${gifts}件`);
  await page.goto(`${srv.base}/gift.html`);
  await settle(page);
  await page.locator('details.sub-action summary').first().click();
  await page.fill('details.sub-action textarea', 'おいしかった');
  await page.locator('details.sub-action button[type=submit]').dblclick();
  await page.waitForTimeout(800);
  const fb = await dbRead(page, "(all) => all.inventoryTx.find((t) => t.kind === 'gift').feedback");
  if (fb !== 'おいしかった') notes.push(`感想：${fb}`);
  const txt = await page.textContent('main');
  if (!/おいしかった/.test(txt)) notes.push('感想を保存しても画面に出ない');
});

// 19. 飲み切りにする を、人の2度押しくらいの間（100〜250ms）で2回
for (const gap of [100, 250]) await flow(`飲み切りの2度押し（${gap}ms）`, 'empty', async (page, notes) => {
  const id = await registerBean(page);
  // 人の2度押しに近づける：page.click は押せるようになるまで待つので、画面の中で gap ms あけて2回押す
  await page.evaluate((ms) => new Promise((ok) => {
    const btn = document.getElementById('toggleFinished');
    btn.click();
    setTimeout(() => { btn.click(); ok(); }, ms);
  }), gap);
  await page.waitForTimeout(1200);
  const st = await dbRead(page, `(all) => all.beans.find((b) => b.id === ${JSON.stringify(id)}).status`);
  if (st !== 'finished') notes.push(`「飲み切りにする」を${gap}msあけて2回押すと、状態は ${st}（2回目が「飲み切りを取り消す」として働く）`);
});

// 20. 確認の箱が出るボタンの2度押し（2回目が箱の外に当たって、すぐ閉じないか）
await flow('確認の箱と2度押し', 'empty', async (page, notes) => {
  const id = await registerBean(page);
  await page.locator('#delete').dblclick();
  await page.waitForTimeout(500);
  const open = await page.locator('dialog.confirm-box').count();
  notes.push(`（参考）「削除する」をダブルタップ：確認の箱 ${open ? '出ている' : '出ていない（すぐ閉じた）'}`);
  if (open) await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const alive = await dbRead(page, `(all) => all.beans.find((b) => b.id === ${JSON.stringify(id)}).deletedAt == null`);
  if (!alive) notes.push('Escape で閉じたのに削除された');
  if (await page.locator('dialog.confirm-box').count()) notes.push('Escape のあとも確認の箱が残る');
});

// 21. 手元の豆を、編集で「入荷待ち」に戻す（入庫が消えて残りがマイナスにならないか）
await flow('編集で入荷待ちに戻す', 'empty', async (page, notes) => {
  const id = await registerBean(page, { actual: '200' });
  await page.locator('#cupForm button[type=submit]').click();
  await page.waitForTimeout(600);
  await page.goto(`${srv.base}/bean-edit.html?id=${id}`);
  await settle(page);
  // 総仕上げの70番：使った記録がある豆は「入荷待ち」を選べない
  if (await page.locator('[name=status][value=ordered]').isDisabled()) {
    notes.push('（参考）1杯淹れたあとの編集：「入荷待ち」は選べない');
    return;
  }
  await page.evaluate(() => [...document.querySelectorAll('[name=status]')].forEach((r) => (r.checked = r.value === 'ordered')));
  await page.click('#save');
  await page.waitForURL(/bean\.html/);
  await settle(page);
  const r = await remainOf(page, id);
  const kinds = await dbRead(page, `(all) => all.inventoryTx.filter((t) => t.beanId === ${JSON.stringify(id)} && t.deletedAt == null).map((t) => t.kind + t.deltaG)`);
  notes.push(`（参考）1杯淹れたあとで入荷待ちに戻す：記録の残り ${r}g（${kinds.join(',')}）`);
  await page.fill('#arrivalWeight', '200');
  await page.fill('#arrivalForm [name=roastDate]', '2026-11-15');
  await page.locator('#arrivalForm button[type=submit]').click();
  await page.waitForTimeout(800);
  notes.push(`（参考）もう一度「届いた」200g：記録の残り ${await remainOf(page, id)}g、画面 ${await page.textContent('#remain')}`);
});

// 22. 登録ボタンの2度押し（豆・気になる豆・注文メール）
await flow('登録の2度押し', 'empty', async (page, notes) => {
  await page.goto(`${srv.base}/bean-edit.html`);
  await settle(page);
  await page.fill('[name=name]', '2度押しの豆');
  await page.fill('[name=actualWeightG]', '100');
  await page.locator('#save').dblclick();
  await page.waitForURL(/bean\.html/);
  await settle(page);
  const nb = await dbRead(page, '(all) => all.beans.length');
  if (nb !== 1) notes.push(`豆の「登録する」の2度押しで ${nb}件`);
  await page.goto(`${srv.base}/wishlist.html`);
  await settle(page);
  await page.fill('#form [name=name]', '2度押しの気になる豆');
  await page.locator('#save').dblclick();
  await page.waitForTimeout(800);
  const nw = await dbRead(page, '(all) => all.wishlist.length');
  if (nw !== 1) notes.push(`気になる豆の「足す」の2度押しで ${nw}件`);
  const mail = await readFile(new URL('../../tests/fixtures/tonya-order.txt', import.meta.url), 'utf8');
  await page.goto(`${srv.base}/order-import.html`);
  await settle(page);
  await page.fill('#mail', mail);
  await page.click('#read');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const b = document.getElementById('save');
    b.click();
    b.click();
  });
  await page.waitForURL(/beans\.html/);
  await settle(page);
  const no = await dbRead(page, '(all) => all.orders.length');
  if (no !== 1) notes.push(`注文メールの「入荷待ちとして登録」の2度押しで注文が ${no}件`);
  // 「読み取る」の連打（結果が2重にならないか）
  await page.goto(`${srv.base}/order-import.html`);
  await settle(page);
  await page.fill('#mail', mail);
  await page.locator('#read').dblclick();
  await page.waitForTimeout(800);
  const dup = await page.locator('#dupNote').isVisible();
  if (!dup) notes.push('同じ注文メールをもう一度読むと、重複の知らせが出ない');
});

// 23. 豆の画面の読み込みに失敗したとき（途中の部品がエラーを出す）：真っ白のままにならないか
await flow('豆の画面の読み込み失敗', 'empty', async (page, notes) => {
  const id = await registerBean(page);
  // 焙煎度比較の集計（いつも呼ばれる）の先頭でエラーにする
  await page.route('**/js/core/compare.js', async (r) => {
    const res = await r.fetch();
    const body = (await res.text()).replace(/export function roastPreferences\(([^)]*)\) \{/, "export function roastPreferences($1) { throw new Error('わざと');");
    await r.fulfill({ response: res, body });
  });
  await page.goto(`${srv.base}/bean.html?id=${id}`);
  await settle(page);
  await page.waitForTimeout(8500);
  const visible = await page.evaluate(() => !document.getElementById('content').hidden || !document.getElementById('notFound').hidden);
  const loadErr = await page.locator('.load-error').count();
  const shown = await page.evaluate(() => [...document.querySelectorAll('main > *')].filter((e) => e.offsetHeight > 0).map((e) => e.id || e.className || e.tagName));
  notes.push(`（参考）見えている部品：${shown.join(',')}、content.hidden=${await page.evaluate(() => document.getElementById('content').hidden)}`);
  if (!visible && !loadErr) notes.push('読み込みでエラーが起きると、8秒の知らせが消えたあと豆の画面が真っ白のまま（「開き直す」もない）');
  // エラーは集めた中に入るので、ここでは「わざと」のものを除く
}, { ctx: { serviceWorkers: 'block' } }); // Service Worker を通すと page.route が効かない

// 24. 操作は保存できたのに、そのあとの描き直しでエラー：「できませんでした」と出て、押し直すと2件になる
await flow('保存のあとの描き直しの失敗', 'empty', async (page, notes) => {
  const id = await registerBean(page);
  await page.route('**/js/core/compare.js', async (r) => {
    const res = await r.fetch();
    const body = (await res.text()).replace(/export function roastPreferences\(([^)]*)\) \{/, "let __n = 0; export function roastPreferences($1) { if (++__n > 1) throw new Error('わざと');");
    await r.fulfill({ response: res, body });
  });
  await page.goto(`${srv.base}/bean.html?id=${id}`);
  await settle(page);
  await page.locator('#cupForm button[type=submit]').click();
  await page.waitForTimeout(800);
  const toast = await page.textContent('#toast').catch(() => '');
  const n = await dbRead(page, `(all) => all.inventoryTx.filter((t) => t.beanId === ${JSON.stringify(id)} && t.kind === 'brew').length`);
  if (/できませんでした/.test(toast) && n === 1) notes.push(`「1杯淹れた」は保存できたのに「${toast}」と出る（押し直すと2件になる）。画面の残りは ${await page.textContent('#remain')}（記録は ${await remainOf(page, id)}g）`);
}, { ctx: { serviceWorkers: 'block' } });

await browser.close();
await srv.stop();
const bad = results.filter((r) => r.notes.some((n) => !n.startsWith('（参考）')));
console.log(`\n${results.length}の流れのうち、気になる点があったもの：${bad.length}`);
