// オフライン動作（G3）：service worker が端末に保存するファイルの一覧（指紋つき）を作る計算。
// 一覧は scripts/make-sw-manifest.js が sw.js に書き込み、tests/sw-manifest.test.js が作り直し忘れを調べる。

/** 保存するファイルを置くフォルダ（この中は全部、ただし説明やライセンスの文書は除く） */
export const APP_DIRS = ['css/', 'js/', 'icons/', 'vendor/'];

/** 一番上の階層で保存するファイル（.html はすべて） */
export const APP_ROOT_FILES = ['manifest.webmanifest'];

const SKIP_NAMES = /(^|\/)(README\.md|LICENSE|NOTICE)$/i;

/**
 * アプリとして保存するファイルか（パスはリポジトリの一番上からの「/」区切り）
 * sw.js 自身はブラウザが別に管理するので入れない
 * @param {string} path
 */
export function isAppFile(path) {
  if (!path || path.startsWith('.') || path.includes('/.')) return false;
  if (SKIP_NAMES.test(path)) return false;
  if (!path.includes('/')) return path.endsWith('.html') || APP_ROOT_FILES.includes(path);
  return APP_DIRS.some((dir) => path.startsWith(dir));
}

/**
 * SHA-256 を16進の文字列で返す（ブラウザと Node の両方で動く）
 * @param {ArrayBuffer|Uint8Array|string} data
 */
export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * ファイルの一覧から、指紋つきの一覧と版を作る
 * 版はすべてのファイルの指紋から決まるので、どれか1つでも変われば版も変わる
 * @param {{path:string, bytes:ArrayBuffer|Uint8Array|string}[]} files
 * @returns {Promise<{version:string, files:Record<string,string>}>}
 */
export async function buildManifest(files) {
  const entries = [];
  for (const f of files) {
    if (!isAppFile(f.path)) continue;
    entries.push([f.path, (await sha256Hex(f.bytes)).slice(0, 16)]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const version = (await sha256Hex(entries.map(([p, h]) => `${p} ${h}`).join('\n'))).slice(0, 12);
  return { version, files: Object.fromEntries(entries) };
}

export const MANIFEST_START = '// <manifest> npm run sw が書き込む（手で直さない）';
export const MANIFEST_END = '// </manifest>';

/** sw.js に書き込む一覧の部分（始まりと終わりの印を含む） */
export function manifestBlock(manifest) {
  return `${MANIFEST_START}\nconst MANIFEST = ${JSON.stringify(manifest, null, 2)};\n${MANIFEST_END}`;
}

/**
 * sw.js の中身の一覧の部分を差し替える
 * @param {string} swSource
 * @param {{version:string, files:Record<string,string>}} manifest
 */
export function replaceManifestBlock(swSource, manifest) {
  const start = swSource.indexOf(MANIFEST_START);
  const end = swSource.indexOf(MANIFEST_END);
  if (start < 0 || end < start) throw new Error('sw.js に一覧を書く印（<manifest>）が見つかりません');
  return swSource.slice(0, start) + manifestBlock(manifest) + swSource.slice(end + MANIFEST_END.length);
}

/**
 * sw.js の中身から一覧を読み出す（なければ null）
 * @param {string} swSource
 */
export function readManifestBlock(swSource) {
  const start = swSource.indexOf(MANIFEST_START);
  const end = swSource.indexOf(MANIFEST_END);
  if (start < 0 || end < start) return null;
  const body = swSource.slice(start + MANIFEST_START.length, end);
  const json = body.replace(/^\s*const MANIFEST = /, '').replace(/;\s*$/, '');
  return JSON.parse(json);
}

/**
 * HTML が読み込む同じサイト内のファイル（script の src、link の href）
 * ページどうしのリンク（a の href）は含めない
 * @param {string} html
 */
export function htmlAssets(html) {
  const out = new Set();
  for (const m of html.matchAll(/<(script|link|img)\b[^>]*?\b(src|href)="([^"]+)"/gi)) {
    const url = m[3];
    if (/^([a-z]+:|\/\/|#)/i.test(url)) continue;
    out.add(url.replace(/^\.\//, '').replace(/[?#].*$/, ''));
  }
  return [...out];
}

/**
 * JavaScript の import 先（相対パス）を、そのファイルからの位置で解決して返す
 * @param {string} fromPath 例 'js/index-page.js'
 * @param {string} source
 */
export function jsImports(fromPath, source) {
  const out = new Set();
  const re = /\b(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith('.')) continue;
    out.add(resolvePath(fromPath, spec));
  }
  return [...out];
}

function resolvePath(fromPath, spec) {
  const parts = fromPath.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}
