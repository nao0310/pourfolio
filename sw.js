// service worker：オフライン動作（G3）
// - アプリの全ファイルを、版ごとの保存場所（Cache Storage の pourfolio-<版>）に入れ、そこから画面を開く
// - 新しい版は全ファイルを取り直し、指紋（SHA-256）がすべて一覧と合ったときだけ準備完了にする
//   （古いファイルが混ざった版には切り替えない。次に開いたときにやり直す）
// - 準備ができた新しい版は、画面の「更新する」で切り替える（初めて保存するときだけはすぐ切り替える）
// - 開発用サーバー（localhost）では、通信できるときは最新のファイル、できないときだけ保存したファイルを使う
// ここはモジュールにできない（iPhoneの古い版でも動かすため）ので、計算は下の関数にまとめ、tests/sw.test.js で確かめる。

// <manifest> npm run sw が書き込む（手で直さない）
const MANIFEST = {
  "label": "2.3.1",
  "version": "6e25bdbaaae8",
  "files": {
    "bean-edit.html": "b4ab5c1cb88b2a27",
    "bean.html": "52b1b3a8772eef17",
    "beans.html": "396ed68385b49b36",
    "brew.html": "1c85e9b8aa6eb49b",
    "compare.html": "5254a5bc290af28d",
    "cost.html": "7efaa229edbe76c3",
    "css/base.css": "3b52fb73a18d5f21",
    "data.html": "17a94561efe5a609",
    "equipment-edit.html": "42de8951a09272a3",
    "equipment.html": "ad84ca1c98692907",
    "icons/apple-touch-icon.png": "d47279adae204755",
    "icons/icon-192.png": "bcb5cc1b418e8852",
    "icons/icon-512.png": "497d0329a3dad10a",
    "index.html": "5c3a4d95cf52e7f8",
    "js/bean-edit-page.js": "1b91aa9508cc977f",
    "js/bean-page.js": "750c309003df485c",
    "js/beans-page.js": "cc792bacb8e946cd",
    "js/brew-draft.js": "d7586b9a8f874516",
    "js/brew-page.js": "9e4d95aba4403c04",
    "js/compare-page.js": "8e4fbcd0f25de255",
    "js/core/backup.js": "0ef4ff8bb8b876bd",
    "js/core/beans.js": "8419d0b8b44e63d6",
    "js/core/brews.js": "96cb92b979415477",
    "js/core/compare.js": "2e3ea884c75c2aaa",
    "js/core/cost.js": "814376caa01c3338",
    "js/core/csv.js": "118eb24c1f75be97",
    "js/core/dialin.js": "fbdeef29b0af89c8",
    "js/core/equipment.js": "1666ceecf4236724",
    "js/core/flavors.js": "89fe07c6a438754f",
    "js/core/format.js": "68dfb9fe90fb5974",
    "js/core/freshness.js": "4d56dabbc6fc23b5",
    "js/core/frozen.js": "a3457f6e304eb9fb",
    "js/core/home.js": "eb1e92b098ef8260",
    "js/core/install.js": "1ce19201bb995ac2",
    "js/core/inventory.js": "c41b0195f0272cae",
    "js/core/offline.js": "907135ce0abe78fb",
    "js/core/orders.js": "029a40c611f71c86",
    "js/core/photos.js": "92c3236ca612f895",
    "js/core/recipes.js": "55ddfa6fcd9cd3f0",
    "js/core/records.js": "6ba3cc4987ed52ec",
    "js/core/restock.js": "27a93133facd5d34",
    "js/core/roast.js": "e713f66bb296aa2d",
    "js/core/sample-data.js": "bcb0a1097337453f",
    "js/core/shops.js": "5cea814d683272ae",
    "js/core/tastings.js": "5d49b1a72a18a144",
    "js/core/timer.js": "158a32d82adfeb48",
    "js/core/tonya.js": "faac59308d2b0ca5",
    "js/core/version.js": "43608b50b708ce6d",
    "js/cost-page.js": "c20bca9c70ccf702",
    "js/cue.js": "4ec66c174d81b2d6",
    "js/data-page.js": "4f7d7b8859bcb1d6",
    "js/db.js": "6e5f2628a3937990",
    "js/equipment-edit-page.js": "189ab98a4f008939",
    "js/equipment-page.js": "b1bf191837d8dac2",
    "js/index-page.js": "71f6c61e3ce62aeb",
    "js/order-import-page.js": "b2e0b1a0c4a708e1",
    "js/photo.js": "c7fc369546686540",
    "js/pwa.js": "0a455ba0a3ad9be0",
    "js/recipe-edit-page.js": "5a6c1ceaff4049fe",
    "js/recipes-page.js": "f56e2275daa4067a",
    "js/shopping-page.js": "3360db95c67c33fe",
    "js/shops-page.js": "294280fbc9b1e6f0",
    "js/storage-test.js": "5000534b3289040c",
    "js/tasting-page.js": "5baeeed1f2e36097",
    "js/tasting-parts.js": "d094ff267290f070",
    "js/ui.js": "403bfdf514e9a601",
    "js/wake-lock.js": "3d49196eb9e85b57",
    "manifest.webmanifest": "6ba74664b83078e8",
    "order-import.html": "e70996fdf4e839d1",
    "recipe-edit.html": "4cd31df84ec67cd1",
    "recipes.html": "78df86e00899632f",
    "shopping.html": "995d1d9f9a84f317",
    "shops.html": "fd07a6b5b9c94a60",
    "storage-test.html": "55d68ef5a3e34561",
    "tasting.html": "fcd4a4b34104fdd8",
    "vendor/dexie/dexie.mjs": "c3ecb25376f4e2d1"
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
