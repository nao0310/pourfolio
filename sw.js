// service worker：オフライン動作（G3）
// - アプリの全ファイルを、版ごとの保存場所（Cache Storage の pourfolio-<版>）に入れ、そこから画面を開く
// - 新しい版は全ファイルを取り直し、指紋（SHA-256）がすべて一覧と合ったときだけ準備完了にする
//   （古いファイルが混ざった版には切り替えない。次に開いたときにやり直す）
// - 準備ができた新しい版は、画面の「更新する」で切り替える（初めて保存するときだけはすぐ切り替える）
// - 開発用サーバー（localhost）では、通信できるときは最新のファイル、できないときだけ保存したファイルを使う
// ここはモジュールにできない（iPhoneの古い版でも動かすため）ので、計算は下の関数にまとめ、tests/sw.test.js で確かめる。

// <manifest> npm run sw が書き込む（手で直さない）
const MANIFEST = {
  "label": "3.6.4",
  "version": "2445f3504788",
  "files": {
    "aging.html": "e375c2c6820a60f3",
    "ai.html": "34607ec38ddc5690",
    "analysis.html": "1c949e97290a0af7",
    "bean-edit.html": "2532623433b68b7d",
    "bean.html": "ff54522a0e965006",
    "beans.html": "26425111ec44eea4",
    "brew-chart.html": "5e33be4e3915833d",
    "brew.html": "3b61657bad55aeb5",
    "calendar.html": "add01bf22879b657",
    "compare.html": "baf354ef14f2b2e1",
    "cost.html": "2c834b6cf3df809b",
    "css/base.css": "c5041d73746e2457",
    "css/print.css": "c29fd9833cc30c3d",
    "data.html": "0c9816a3ec7a9025",
    "dialin-history.html": "0d8a41cb504c8b0d",
    "equipment-edit.html": "0780a9c30528edff",
    "equipment.html": "899bcd05be7c1d5d",
    "factors.html": "f2380994a76e8f74",
    "gift.html": "c275ed42d1a7b282",
    "glossary.html": "46ff0e519c0e88a8",
    "icons/apple-touch-icon.png": "d47279adae204755",
    "icons/icon-192.png": "bcb5cc1b418e8852",
    "icons/icon-512.png": "497d0329a3dad10a",
    "index.html": "3c611e23ff2f1ab8",
    "js/aging-page.js": "31ddedd2ae860251",
    "js/ai-page.js": "39713c470946ed17",
    "js/analysis-data.js": "2f20437023503c41",
    "js/analysis-page.js": "e6120449e3dd0f53",
    "js/autosave-file.js": "3afabe88dc7a0698",
    "js/bean-edit-page.js": "8f0ba4da55d69296",
    "js/bean-page.js": "a26580859b243095",
    "js/beans-page.js": "468949f321e1ebf6",
    "js/brew-chart-page.js": "69e71a0bcfc682cc",
    "js/brew-draft.js": "d7586b9a8f874516",
    "js/brew-image.js": "87041b34649c1ccf",
    "js/brew-page.js": "b959ba32f0be08b1",
    "js/calendar-page.js": "2c52055553243dd3",
    "js/chart.js": "bfe7bcfbcfd6aa36",
    "js/compare-page.js": "f4c2917daf4da186",
    "js/confirm-box.js": "ea02e1a257d963be",
    "js/core/aging.js": "bee1e4e2db40550c",
    "js/core/ai-text.js": "f1bca9dcc994dfed",
    "js/core/analysis.js": "165493d2d7d14e84",
    "js/core/autosave.js": "48c2c11a385d1e22",
    "js/core/backup.js": "0955d3aaeb07c043",
    "js/core/beans.js": "a7f78afaf4df6af8",
    "js/core/brew-chart.js": "fc278a68a2345e4d",
    "js/core/brews.js": "7a527dd9923df42d",
    "js/core/caffeine.js": "3efc3f469f5b77b9",
    "js/core/calendar.js": "99f0de2ac4d7ba16",
    "js/core/card-text.js": "16a728ca4ff6ad8c",
    "js/core/chart-scale.js": "b7cfe06796a7ccc0",
    "js/core/compare.js": "eab7c0d5d459cadb",
    "js/core/cost.js": "814376caa01c3338",
    "js/core/csv.js": "d2fd0bb947db08aa",
    "js/core/demo-data.js": "3b84872cd58fba05",
    "js/core/dialin-history.js": "a4f7f51056e83151",
    "js/core/dialin.js": "ef98796b50dc9432",
    "js/core/dismiss.js": "282db3ad92fad322",
    "js/core/equipment.js": "5d20a6b6f7763514",
    "js/core/errors.js": "e1a2841f6bbf37e5",
    "js/core/experiment-plan.js": "da354a519e52d54d",
    "js/core/extraction.js": "442b41f0a73c8ecd",
    "js/core/factors.js": "92927016f74b9670",
    "js/core/flavors.js": "89fe07c6a438754f",
    "js/core/fonts.js": "434bc1cbc04d16c4",
    "js/core/format.js": "b4c9a5e24af6cbe4",
    "js/core/freshness.js": "4d56dabbc6fc23b5",
    "js/core/frozen.js": "4426f1550cb5a9e2",
    "js/core/ghost.js": "ea96c6aa0447791f",
    "js/core/gift.js": "d46ad9f251e775c1",
    "js/core/glossary.js": "eca0f53f083e78f1",
    "js/core/grinder-scale.js": "8fdefe41b3440c73",
    "js/core/handover.js": "54ad277c75827fbe",
    "js/core/home.js": "154612fd596d9d44",
    "js/core/initial-recipe.js": "d9383e0e76c31245",
    "js/core/install.js": "1ce19201bb995ac2",
    "js/core/inventory.js": "ded15007fcb42145",
    "js/core/keyboard.js": "2404d488e817e713",
    "js/core/life.js": "8fa371cefae9e783",
    "js/core/maintenance.js": "e347bf56fe8095f9",
    "js/core/monthly.js": "c2e3b77b1bbe7a37",
    "js/core/next-bean.js": "25091e04bb67413c",
    "js/core/offline.js": "907135ce0abe78fb",
    "js/core/once.js": "65ced3a0a36e7800",
    "js/core/optimize.js": "8c9f6ad01dac34e3",
    "js/core/orders.js": "029a40c611f71c86",
    "js/core/origin-map.js": "a3ca5535b39b8f84",
    "js/core/page-life.js": "5751d8c7b4821f5d",
    "js/core/photos.js": "92c3236ca612f895",
    "js/core/phrases.js": "2c6a36f68e5ebcfe",
    "js/core/plan-adjust.js": "94fe652d301b93f5",
    "js/core/preference.js": "2241f672110db057",
    "js/core/qr-code.js": "a093be50d9c1160a",
    "js/core/recipes.js": "55ddfa6fcd9cd3f0",
    "js/core/records.js": "68edcc359070daef",
    "js/core/report-image.js": "b81be060c39dc593",
    "js/core/repro.js": "0eec519bd68c8fc9",
    "js/core/restock.js": "695219e768ed6675",
    "js/core/roast.js": "e713f66bb296aa2d",
    "js/core/sample-data.js": "dc92d4c2f980eca7",
    "js/core/scan-target.js": "d85329c99fba8dc4",
    "js/core/share-code.js": "1073c340ceae3ab1",
    "js/core/shops.js": "518dd8898970c5f6",
    "js/core/tabs.js": "c488733d406d0bc8",
    "js/core/tastings.js": "db684e7d7220300f",
    "js/core/timer.js": "44c780ecb4da4208",
    "js/core/today.js": "1814a6c90e899543",
    "js/core/tonya.js": "faac59308d2b0ca5",
    "js/core/usual.js": "306c68f4420764a8",
    "js/core/version.js": "583e64d3681db719",
    "js/core/water.js": "26dace0c46b908b4",
    "js/core/weather.js": "1e5ba95845db72dc",
    "js/core/wishlist.js": "6bf3695085913224",
    "js/core/wrapped.js": "b9734e47ba5f413c",
    "js/cost-page.js": "8021da987114b4f4",
    "js/cue.js": "4ec66c174d81b2d6",
    "js/data-page.js": "12e9d950cf3cc0e8",
    "js/db.js": "288f45ff06f01e6a",
    "js/dialin-history-page.js": "7c2cbd818e428ea7",
    "js/dismiss-card.js": "921121bddba7e14e",
    "js/equipment-edit-page.js": "9f13a45496bb2f71",
    "js/equipment-page.js": "4a6aa305d6f99bae",
    "js/factors-page.js": "b455f56a4c1e44a2",
    "js/gift-page.js": "c0109c10d861cd5d",
    "js/glossary-page.js": "01c87012f113801b",
    "js/index-page.js": "91ed8cefd37ef29d",
    "js/keyboard-check.js": "938636e57502f307",
    "js/layout.js": "58569782b0a6e3f3",
    "js/life-page.js": "5ca3b60c5aebdf12",
    "js/more-page.js": "1b2f722ab0b9c696",
    "js/optimize-page.js": "41fc5e6f125f204f",
    "js/order-import-page.js": "bd07f807d74b25c4",
    "js/page-life.js": "9a2125b8dc5d6780",
    "js/photo.js": "c7fc369546686540",
    "js/profile-page.js": "0bdbcbac7549db89",
    "js/pwa.js": "5a839921e98fb31b",
    "js/recipe-card-page.js": "32f9002cbffdcb4a",
    "js/recipe-edit-page.js": "3bfe38bb91f38a46",
    "js/recipes-page.js": "8d2f655e1feac502",
    "js/report-page.js": "79abc28af62fdefe",
    "js/repro-page.js": "f5984869c969e663",
    "js/scan-page.js": "d354801bceddc01b",
    "js/share-page.js": "4ac65dc4f449bd88",
    "js/shopping-page.js": "23a4e13b177e092a",
    "js/shops-page.js": "650950bbeed20a81",
    "js/storage-check.js": "1d93bce06a11ea7a",
    "js/storage-test.js": "e34d95417c2f1da8",
    "js/tabbar.js": "7b0fddc5ce1e9056",
    "js/tasting-page.js": "46eb0720cd167f8b",
    "js/tasting-parts.js": "d094ff267290f070",
    "js/today-page.js": "d5cdb9d24559dd08",
    "js/ui.js": "fb3d19bbecbecc64",
    "js/wake-lock.js": "accb7f303160e088",
    "js/weather-page.js": "fefb36d00d8ba3f0",
    "js/weather-sync.js": "48f404f0568ce83c",
    "js/wishlist-page.js": "0d8ed7fe72de519a",
    "js/wrapped-image.js": "96ef271959544280",
    "js/wrapped-page.js": "eaf0ff8d3602554d",
    "life.html": "142745f2678a3b4d",
    "manifest.webmanifest": "6ba74664b83078e8",
    "more.html": "306dc9f0ce8761fa",
    "optimize.html": "3050aeeff6bd265f",
    "order-import.html": "29b597f1b8489c67",
    "profile.html": "59fa64fcb7db1dae",
    "recipe-card.html": "55100f7080591bd6",
    "recipe-edit.html": "baed9428ad97a5cf",
    "recipes.html": "57aef8c49cc5ff1f",
    "report.html": "a3a89eba5a18e1b9",
    "repro.html": "174c7f161a434dd2",
    "scan.html": "9f4a2a6a0bb0236b",
    "share.html": "5a3a3be0f1f560a7",
    "shopping.html": "6ef3bbaa4fc91df9",
    "shops.html": "3b9f8828ffb067ea",
    "storage-test.html": "eb7ed9a16d1d66bd",
    "tasting.html": "814b24730aa17eda",
    "today.html": "3d75c956a05d1790",
    "vendor/dexie/dexie.mjs": "c3ecb25376f4e2d1",
    "vendor/jsqr/jsQR.js": "bc40c8a15196236b",
    "vendor/qrcode-generator/qrcode.mjs": "ea91d7118a539528",
    "weather.html": "97e19a332f650bd9",
    "wishlist.html": "12edc39ece76a9fd",
    "wrapped.html": "721f67931d2152c0"
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
