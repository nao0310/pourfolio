// service worker：オフライン動作（G3）
// - アプリの全ファイルを、版ごとの保存場所（Cache Storage の pourfolio-<版>）に入れ、そこから画面を開く
// - 新しい版は全ファイルを取り直し、指紋（SHA-256）がすべて一覧と合ったときだけ準備完了にする
//   （古いファイルが混ざった版には切り替えない。次に開いたときにやり直す）
// - 準備ができた新しい版は、画面の「更新する」で切り替える（初めて保存するときだけはすぐ切り替える）
// - 開発用サーバー（localhost）では、通信できるときは最新のファイル、できないときだけ保存したファイルを使う
// ここはモジュールにできない（iPhoneの古い版でも動かすため）ので、計算は下の関数にまとめ、tests/sw.test.js で確かめる。

// <manifest> npm run sw が書き込む（手で直さない）
const MANIFEST = {
  "label": "2.8",
  "version": "aeffbc6f050a",
  "files": {
    "ai.html": "3c8af042c22bb904",
    "analysis.html": "95edaebc90b88064",
    "bean-edit.html": "91cd4ff6fc3f20bc",
    "bean.html": "b8291708f0f6cfe8",
    "beans.html": "0164035ab77bdec4",
    "brew-chart.html": "02ae1a89fcced82a",
    "brew.html": "bc82af0762c414cb",
    "calendar.html": "3ca39c2ae85a2423",
    "compare.html": "9d7afc81fbe054a9",
    "cost.html": "5d2a972d7ccae1cc",
    "css/base.css": "61bef7b7f5409f8a",
    "css/print.css": "8c007c2e176a70f2",
    "data.html": "ab127d03fbb52c74",
    "dialin-history.html": "2600f404fb2023b0",
    "equipment-edit.html": "86558e880c8dde97",
    "equipment.html": "59eb268c33873a92",
    "factors.html": "32a76de14e3f2180",
    "icons/apple-touch-icon.png": "d47279adae204755",
    "icons/icon-192.png": "bcb5cc1b418e8852",
    "icons/icon-512.png": "497d0329a3dad10a",
    "index.html": "59f8552f05111292",
    "js/ai-page.js": "9289c4d72ec1170e",
    "js/analysis-data.js": "e240bf34f1248aaf",
    "js/analysis-page.js": "a9411e5b25908663",
    "js/autosave-file.js": "f7b7453f1b256c61",
    "js/bean-edit-page.js": "ceba47ea5a6b004a",
    "js/bean-page.js": "212bc26e86492fcf",
    "js/beans-page.js": "cc792bacb8e946cd",
    "js/brew-chart-page.js": "1b79f27da2a171bf",
    "js/brew-draft.js": "d7586b9a8f874516",
    "js/brew-image.js": "7271711ef411af36",
    "js/brew-page.js": "8619f017e3bc922f",
    "js/calendar-page.js": "498481f8d95cf1e8",
    "js/chart.js": "bfe7bcfbcfd6aa36",
    "js/compare-page.js": "7a24d527e42655e8",
    "js/confirm-box.js": "25ef25c80f228e42",
    "js/core/ai-text.js": "5b786a522a1e48f4",
    "js/core/analysis.js": "165493d2d7d14e84",
    "js/core/autosave.js": "48c2c11a385d1e22",
    "js/core/backup.js": "0ef4ff8bb8b876bd",
    "js/core/beans.js": "9da032fa584ebf0b",
    "js/core/brew-chart.js": "fc278a68a2345e4d",
    "js/core/brews.js": "02a9752d2f65c8c0",
    "js/core/caffeine.js": "d71bf12a410ea19b",
    "js/core/calendar.js": "99f0de2ac4d7ba16",
    "js/core/card-text.js": "13a930be2c76b5f9",
    "js/core/chart-scale.js": "b7cfe06796a7ccc0",
    "js/core/compare.js": "2e3ea884c75c2aaa",
    "js/core/cost.js": "814376caa01c3338",
    "js/core/csv.js": "d2fd0bb947db08aa",
    "js/core/demo-data.js": "479bf74cf59b3439",
    "js/core/dialin-history.js": "a4f7f51056e83151",
    "js/core/dialin.js": "ec3ef172c6b415e5",
    "js/core/dismiss.js": "e4be07bfd1117cd1",
    "js/core/equipment.js": "5d20a6b6f7763514",
    "js/core/extraction.js": "442b41f0a73c8ecd",
    "js/core/factors.js": "92927016f74b9670",
    "js/core/flavors.js": "89fe07c6a438754f",
    "js/core/format.js": "b4c9a5e24af6cbe4",
    "js/core/freshness.js": "4d56dabbc6fc23b5",
    "js/core/frozen.js": "4426f1550cb5a9e2",
    "js/core/ghost.js": "b4a197f101c8ae9a",
    "js/core/grinder-scale.js": "8fdefe41b3440c73",
    "js/core/home.js": "9f8feb0bf29e19e5",
    "js/core/initial-recipe.js": "d9383e0e76c31245",
    "js/core/install.js": "1ce19201bb995ac2",
    "js/core/inventory.js": "ded15007fcb42145",
    "js/core/monthly.js": "ad4ba1bfd7535622",
    "js/core/offline.js": "907135ce0abe78fb",
    "js/core/once.js": "65ced3a0a36e7800",
    "js/core/orders.js": "029a40c611f71c86",
    "js/core/photos.js": "92c3236ca612f895",
    "js/core/plan-adjust.js": "91901f6e8d9cfc96",
    "js/core/preference.js": "2241f672110db057",
    "js/core/qr-code.js": "a093be50d9c1160a",
    "js/core/recipes.js": "55ddfa6fcd9cd3f0",
    "js/core/records.js": "6ba3cc4987ed52ec",
    "js/core/report-image.js": "b81be060c39dc593",
    "js/core/restock.js": "27a93133facd5d34",
    "js/core/roast.js": "e713f66bb296aa2d",
    "js/core/sample-data.js": "319cceeb6cfea345",
    "js/core/scan-target.js": "d85329c99fba8dc4",
    "js/core/share-code.js": "1073c340ceae3ab1",
    "js/core/shops.js": "5cea814d683272ae",
    "js/core/tabs.js": "9b495c1265530b35",
    "js/core/tastings.js": "db684e7d7220300f",
    "js/core/timer.js": "44c780ecb4da4208",
    "js/core/today.js": "0af45ace936a8ee4",
    "js/core/tonya.js": "faac59308d2b0ca5",
    "js/core/usual.js": "306c68f4420764a8",
    "js/core/version.js": "b635aea444758586",
    "js/core/water.js": "26dace0c46b908b4",
    "js/cost-page.js": "c20bca9c70ccf702",
    "js/cue.js": "4ec66c174d81b2d6",
    "js/data-page.js": "2f9cf103c0a8714c",
    "js/db.js": "1058e1e233a5dc90",
    "js/dialin-history-page.js": "aabb2a000b58c532",
    "js/dismiss-card.js": "921121bddba7e14e",
    "js/equipment-edit-page.js": "532764acd65d95ec",
    "js/equipment-page.js": "10f3117ae63f7284",
    "js/factors-page.js": "996804a3d79f74dc",
    "js/index-page.js": "3d590d191a166cb1",
    "js/more-page.js": "1b2f722ab0b9c696",
    "js/order-import-page.js": "adf1503e63a6ac39",
    "js/photo.js": "c7fc369546686540",
    "js/profile-page.js": "05031ef78b0c77c2",
    "js/pwa.js": "0a455ba0a3ad9be0",
    "js/recipe-card-page.js": "8607ab34fd6de2a8",
    "js/recipe-edit-page.js": "56728fc2a1a0368a",
    "js/recipes-page.js": "b4ac53bdabbe12bc",
    "js/report-page.js": "8eede690ea7e931c",
    "js/scan-page.js": "d354801bceddc01b",
    "js/share-page.js": "366dcba891f73dd0",
    "js/shopping-page.js": "3360db95c67c33fe",
    "js/shops-page.js": "294280fbc9b1e6f0",
    "js/storage-test.js": "5000534b3289040c",
    "js/tabbar.js": "7b0fddc5ce1e9056",
    "js/tasting-page.js": "cae5111e7f85854b",
    "js/tasting-parts.js": "d094ff267290f070",
    "js/today-page.js": "f73a256cab1eb556",
    "js/ui.js": "dbbcd0b7d123e81f",
    "js/wake-lock.js": "accb7f303160e088",
    "manifest.webmanifest": "6ba74664b83078e8",
    "more.html": "355dcdcfd4fb8b0c",
    "order-import.html": "680784e8b36a9fdc",
    "profile.html": "c0c3faf6876e1f96",
    "recipe-card.html": "acbba3acb246d895",
    "recipe-edit.html": "1349c0f4e2a4132b",
    "recipes.html": "8210070a3a07250e",
    "report.html": "e8da437298b4331c",
    "scan.html": "5ed120bb4ccc0488",
    "share.html": "45863a60c9a763bb",
    "shopping.html": "48e458520ba4101e",
    "shops.html": "571c7544e7918f70",
    "storage-test.html": "bf3f079cad9778eb",
    "tasting.html": "8db90832db753f88",
    "today.html": "bf3ebf340e29c8b7",
    "vendor/dexie/dexie.mjs": "c3ecb25376f4e2d1",
    "vendor/jsqr/jsQR.js": "bc40c8a15196236b",
    "vendor/qrcode-generator/qrcode.mjs": "ea91d7118a539528"
  }
};
// </manifest>

const CACHE_PREFIX = 'pourfolio-';
const HASH_HEADER = 'x-pourfolio-hash';

/** 版の保存場所の名前 */
function cacheNameOf(version) {
  return CACHE_PREFIX + version;
}

/** 開発用のサーバーか */
function isDevHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * 開かれたURLを、保存したファイルの名前（一覧のキー）に直す。保存の対象でなければ null
 * 例：…/pourfolio/ → index.html、…/brew.html?recipe=x → brew.html
 * @param {string} url
 * @param {string} scope 例 'https://nao0310.github.io/pourfolio/'
 * @param {Record<string,string>} files 一覧
 */
function cacheKeyFor(url, scope, files) {
  const u = new URL(url);
  const s = new URL(scope);
  if (u.origin !== s.origin || !u.pathname.startsWith(s.pathname)) return null;
  let path = decodeURIComponent(u.pathname.slice(s.pathname.length));
  if (path === '' || path.endsWith('/')) path += 'index.html';
  return Object.prototype.hasOwnProperty.call(files, path) ? path : null;
}

/** 取り直すときのURL（途中の配信サーバーやブラウザの一時保存に残った古いファイルを避けるため、指紋を付ける） */
function freshUrl(path, hash) {
  return `${path}?v=${hash}`;
}

/**
 * 古い版の保存場所のうち、消すもの
 * @param {string[]} names すべての保存場所の名前
 * @param {string} keep 今の版の名前
 */
function oldCacheNames(names, keep) {
  return names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== keep);
}

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 前の版に同じ指紋のファイルがあれば、取り直さずにそれを使う */
async function findSameFile(path, hash) {
  const names = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX));
  for (const name of names) {
    const res = await (await caches.open(name)).match(path);
    if (res && res.headers.get(HASH_HEADER) === hash) return res;
  }
  return null;
}

/** 1つのファイルを取り、指紋を確かめて、保存する形にする */
async function fetchVerified(path, hash, verify) {
  const reused = await findSameFile(path, hash);
  if (reused) return reused;
  const res = await fetch(new Request(verify ? freshUrl(path, hash) : path, { cache: 'reload' }));
  if (!res.ok) throw new Error(`${path} を取れませんでした（${res.status}）`);
  const buf = await res.arrayBuffer();
  if (verify) {
    const got = (await sha256Hex(buf)).slice(0, hash.length);
    if (got !== hash) throw new Error(`${path} が新しい版ではありません（一覧 ${hash}、届いた ${got}）`);
  }
  const headers = new Headers({ [HASH_HEADER]: hash });
  const type = res.headers.get('content-type');
  if (type) headers.set('content-type', type);
  return new Response(buf, { status: 200, headers });
}

async function install() {
  const name = cacheNameOf(MANIFEST.version);
  const verify = !isDevHost(self.location.hostname);
  const isFirst = (await caches.keys()).every((n) => !n.startsWith(CACHE_PREFIX) || n === name);
  const responses = await Promise.all(
    Object.entries(MANIFEST.files).map(async ([path, hash]) => [path, await fetchVerified(path, hash, verify)]),
  );
  // 全部そろってから書く（途中で失敗したら、この版は使わない）
  const cache = await caches.open(name);
  await Promise.all(responses.map(([path, res]) => cache.put(path, res)));
  if (isFirst) await self.skipWaiting();
}

async function activate() {
  const keep = cacheNameOf(MANIFEST.version);
  await Promise.all(oldCacheNames(await caches.keys(), keep).map((n) => caches.delete(n)));
  await self.clients.claim();
}

async function respond(request, key) {
  const cache = await caches.open(cacheNameOf(MANIFEST.version));
  if (isDevHost(self.location.hostname)) {
    try {
      return await fetch(request);
    } catch (err) {
      const hit = await cache.match(key);
      if (hit) return hit;
      throw err;
    }
  }
  return (await cache.match(key)) ?? fetch(request);
}

/** 今の版が全部保存できているか */
async function isReady() {
  const cache = await caches.open(cacheNameOf(MANIFEST.version));
  const keys = await cache.keys();
  return keys.length >= Object.keys(MANIFEST.files).length;
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', (event) => event.waitUntil(install()));
  self.addEventListener('activate', (event) => event.waitUntil(activate()));

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const key = cacheKeyFor(request.url, self.registration.scope, MANIFEST.files);
    if (!key) return;
    event.respondWith(respond(request, key));
  });

  self.addEventListener('message', (event) => {
    const msg = event.data ?? {};
    if (msg.type === 'skipWaiting') {
      self.skipWaiting();
    } else if (msg.type === 'status' && event.ports[0]) {
      isReady().then(
        (ready) => event.ports[0].postMessage({ version: MANIFEST.version, label: MANIFEST.label ?? null, ready }),
        () => event.ports[0].postMessage({ version: MANIFEST.version, label: MANIFEST.label ?? null, ready: false }),
      );
    }
  });
}
