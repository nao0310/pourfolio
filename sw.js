// service worker：オフライン動作（G3）
// - アプリの全ファイルを、版ごとの保存場所（Cache Storage の pourfolio-<版>）に入れ、そこから画面を開く
// - 新しい版は全ファイルを取り直し、指紋（SHA-256）がすべて一覧と合ったときだけ準備完了にする
//   （古いファイルが混ざった版には切り替えない。次に開いたときにやり直す）
// - 準備ができた新しい版は、画面の「更新する」で切り替える（初めて保存するときだけはすぐ切り替える）
// - 開発用サーバー（localhost）では、通信できるときは最新のファイル、できないときだけ保存したファイルを使う
// ここはモジュールにできない（iPhoneの古い版でも動かすため）ので、計算は下の関数にまとめ、tests/sw.test.js で確かめる。

// <manifest> npm run sw が書き込む（手で直さない）
const MANIFEST = {
  "label": "3.2",
  "version": "2987890fd340",
  "files": {
    "ai.html": "34607ec38ddc5690",
    "analysis.html": "97fad6697d25fa7e",
    "bean-edit.html": "2532623433b68b7d",
    "bean.html": "10ec745239a0a50e",
    "beans.html": "0d58d5991ec0c951",
    "brew-chart.html": "5e33be4e3915833d",
    "brew.html": "b40d183826c8528a",
    "calendar.html": "add01bf22879b657",
    "compare.html": "ac48d24b98df158d",
    "cost.html": "2c834b6cf3df809b",
    "css/base.css": "8fb605e77088447c",
    "css/print.css": "8c007c2e176a70f2",
    "data.html": "db703c97881020e1",
    "dialin-history.html": "9ad393d39526e93b",
    "equipment-edit.html": "86558e880c8dde97",
    "equipment.html": "e86ffc6f64e81789",
    "factors.html": "f2380994a76e8f74",
    "icons/apple-touch-icon.png": "d47279adae204755",
    "icons/icon-192.png": "bcb5cc1b418e8852",
    "icons/icon-512.png": "497d0329a3dad10a",
    "index.html": "49ecfb981443dfc8",
    "js/ai-page.js": "39713c470946ed17",
    "js/analysis-data.js": "2f20437023503c41",
    "js/analysis-page.js": "52247d10cc554a5a",
    "js/autosave-file.js": "68712c916f1c79ac",
    "js/bean-edit-page.js": "bb441338e41f1505",
    "js/bean-page.js": "57d65d54e3356018",
    "js/beans-page.js": "35b915c707586108",
    "js/brew-chart-page.js": "1b79f27da2a171bf",
    "js/brew-draft.js": "d7586b9a8f874516",
    "js/brew-image.js": "7271711ef411af36",
    "js/brew-page.js": "9b9779d84b0a3eb8",
    "js/calendar-page.js": "498481f8d95cf1e8",
    "js/chart.js": "bfe7bcfbcfd6aa36",
    "js/compare-page.js": "f4c2917daf4da186",
    "js/confirm-box.js": "25ef25c80f228e42",
    "js/core/ai-text.js": "5b786a522a1e48f4",
    "js/core/analysis.js": "165493d2d7d14e84",
    "js/core/autosave.js": "48c2c11a385d1e22",
    "js/core/backup.js": "0ef4ff8bb8b876bd",
    "js/core/beans.js": "a7f78afaf4df6af8",
    "js/core/brew-chart.js": "fc278a68a2345e4d",
    "js/core/brews.js": "02a9752d2f65c8c0",
    "js/core/caffeine.js": "3efc3f469f5b77b9",
    "js/core/calendar.js": "99f0de2ac4d7ba16",
    "js/core/card-text.js": "13a930be2c76b5f9",
    "js/core/chart-scale.js": "b7cfe06796a7ccc0",
    "js/core/compare.js": "eab7c0d5d459cadb",
    "js/core/cost.js": "814376caa01c3338",
    "js/core/csv.js": "d2fd0bb947db08aa",
    "js/core/demo-data.js": "f695d62067efa87c",
    "js/core/dialin-history.js": "a4f7f51056e83151",
    "js/core/dialin.js": "ec3ef172c6b415e5",
    "js/core/dismiss.js": "62b4b7fde7d14f58",
    "js/core/equipment.js": "5d20a6b6f7763514",
    "js/core/experiment-plan.js": "da354a519e52d54d",
    "js/core/extraction.js": "442b41f0a73c8ecd",
    "js/core/factors.js": "92927016f74b9670",
    "js/core/flavors.js": "89fe07c6a438754f",
    "js/core/format.js": "b4c9a5e24af6cbe4",
    "js/core/freshness.js": "4d56dabbc6fc23b5",
    "js/core/frozen.js": "4426f1550cb5a9e2",
    "js/core/ghost.js": "b4a197f101c8ae9a",
    "js/core/grinder-scale.js": "8fdefe41b3440c73",
    "js/core/home.js": "154612fd596d9d44",
    "js/core/initial-recipe.js": "d9383e0e76c31245",
    "js/core/install.js": "1ce19201bb995ac2",
    "js/core/inventory.js": "ded15007fcb42145",
    "js/core/life.js": "e1094d724775f2df",
    "js/core/monthly.js": "ad4ba1bfd7535622",
    "js/core/next-bean.js": "25091e04bb67413c",
    "js/core/offline.js": "907135ce0abe78fb",
    "js/core/once.js": "65ced3a0a36e7800",
    "js/core/optimize.js": "8c9f6ad01dac34e3",
    "js/core/orders.js": "029a40c611f71c86",
    "js/core/photos.js": "92c3236ca612f895",
    "js/core/phrases.js": "2c6a36f68e5ebcfe",
    "js/core/plan-adjust.js": "94fe652d301b93f5",
    "js/core/preference.js": "2241f672110db057",
    "js/core/qr-code.js": "a093be50d9c1160a",
    "js/core/recipes.js": "55ddfa6fcd9cd3f0",
    "js/core/records.js": "68edcc359070daef",
    "js/core/report-image.js": "b81be060c39dc593",
    "js/core/restock.js": "e50ddd0703d5602f",
    "js/core/roast.js": "e713f66bb296aa2d",
    "js/core/sample-data.js": "8122c5ccebd68c51",
    "js/core/scan-target.js": "d85329c99fba8dc4",
    "js/core/share-code.js": "1073c340ceae3ab1",
    "js/core/shops.js": "518dd8898970c5f6",
    "js/core/tabs.js": "d30ec65024fcc499",
    "js/core/tastings.js": "db684e7d7220300f",
    "js/core/timer.js": "44c780ecb4da4208",
    "js/core/today.js": "1814a6c90e899543",
    "js/core/tonya.js": "faac59308d2b0ca5",
    "js/core/usual.js": "306c68f4420764a8",
    "js/core/version.js": "106cc6d8b1060c31",
    "js/core/water.js": "26dace0c46b908b4",
    "js/core/weather.js": "8152e5a8331c0ab1",
    "js/core/wishlist.js": "6bf3695085913224",
    "js/cost-page.js": "96c52ecdbc7245ae",
    "js/cue.js": "4ec66c174d81b2d6",
    "js/data-page.js": "ec5cee66d930f0c7",
    "js/db.js": "46f9cfd09881d2e1",
    "js/dialin-history-page.js": "aabb2a000b58c532",
    "js/dismiss-card.js": "921121bddba7e14e",
    "js/equipment-edit-page.js": "b131355ea11b9dd7",
    "js/equipment-page.js": "9580dea6e0877c73",
    "js/factors-page.js": "849055aa1ba09678",
    "js/index-page.js": "2c3a5565c7b2d3c6",
    "js/life-page.js": "756edf1b0d5cf961",
    "js/more-page.js": "1b2f722ab0b9c696",
    "js/optimize-page.js": "41fc5e6f125f204f",
    "js/order-import-page.js": "bd07f807d74b25c4",
    "js/photo.js": "c7fc369546686540",
    "js/profile-page.js": "b2decce24460449e",
    "js/pwa.js": "0a455ba0a3ad9be0",
    "js/recipe-card-page.js": "8607ab34fd6de2a8",
    "js/recipe-edit-page.js": "c84dd55ed7058370",
    "js/recipes-page.js": "293a5ac2a7e7b196",
    "js/report-page.js": "30c3c0de2295ec34",
    "js/scan-page.js": "d354801bceddc01b",
    "js/share-page.js": "4aa1b01d2e71049a",
    "js/shopping-page.js": "23a4e13b177e092a",
    "js/shops-page.js": "bb1e391daa0ad3cd",
    "js/storage-test.js": "e34d95417c2f1da8",
    "js/tabbar.js": "7b0fddc5ce1e9056",
    "js/tasting-page.js": "cae5111e7f85854b",
    "js/tasting-parts.js": "d094ff267290f070",
    "js/today-page.js": "b6a42ccf0036e20b",
    "js/ui.js": "7f0ee96367fc54c6",
    "js/wake-lock.js": "accb7f303160e088",
    "js/weather-page.js": "fefb36d00d8ba3f0",
    "js/weather-sync.js": "1497cad2ea2b5242",
    "js/wishlist-page.js": "a76f89120d2d3446",
    "life.html": "142745f2678a3b4d",
    "manifest.webmanifest": "6ba74664b83078e8",
    "more.html": "3b5849f7c1bf93e3",
    "optimize.html": "adf815fb4bbc4353",
    "order-import.html": "1f0962b5a68a6242",
    "profile.html": "59fa64fcb7db1dae",
    "recipe-card.html": "ed53b08ba713c136",
    "recipe-edit.html": "1349c0f4e2a4132b",
    "recipes.html": "cdd946d76519d2fc",
    "report.html": "a3a89eba5a18e1b9",
    "scan.html": "9f4a2a6a0bb0236b",
    "share.html": "991883b0dd54ed2f",
    "shopping.html": "6ef3bbaa4fc91df9",
    "shops.html": "3b9f8828ffb067ea",
    "storage-test.html": "bf3f079cad9778eb",
    "tasting.html": "360b8c0f9d7e57cc",
    "today.html": "3d75c956a05d1790",
    "vendor/dexie/dexie.mjs": "c3ecb25376f4e2d1",
    "vendor/jsqr/jsQR.js": "bc40c8a15196236b",
    "vendor/qrcode-generator/qrcode.mjs": "ea91d7118a539528",
    "weather.html": "97e19a332f650bd9",
    "wishlist.html": "fd3f936e2a627f9c"
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
