// 写真（A7）：抽出1杯の「粉・粉の層・抽出液」の写真（純粋関数）
// 写真は縮小した JPEG を data URL の文字にして、写真の表（photos）に1枚1件で持つ（D-107）。
// 文字にしておくと、書き出しファイル（JSON）にそのまま入り、復元で戻せる。
// 削除するときは画像の文字を消して（dataUrl: null）削除の印を付ける。端末の容量を空けるため。

/** 写真の枠（1杯につき枠ごとに1枚。撮り直すと置き換える） */
export const PHOTO_SLOTS = Object.freeze([
  { key: 'grounds', label: '粉', hint: '挽いた粉' },
  { key: 'bed', label: '粉の層', hint: '落ち切った後のドリッパーの中' },
  { key: 'liquid', label: '抽出液', hint: 'カップやサーバーの液の色' },
]);
export const PHOTO_SLOT_KEYS = Object.freeze(PHOTO_SLOTS.map((s) => s.key));

/** 縮小後の長い辺（px）と JPEG の画質 */
export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_QUALITY = 0.8;

/**
 * 縦横比を保ったまま、長い辺が maxEdge 以下になる大きさ（小さい写真は拡大しない）
 * @returns {{width:number, height:number}}
 */
export function fitSize(width, height, maxEdge = PHOTO_MAX_EDGE) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** 画面に出してよい画像の data URL か（復元したファイルの中身もこれで確かめる） */
export function isImageDataUrl(s) {
  return typeof s === 'string' && DATA_URL.test(s);
}

/** data URL の画像のおおよそのバイト数（base64 の4文字が3バイト） */
export function dataUrlBytes(s) {
  if (typeof s !== 'string') return 0;
  const i = s.indexOf(',');
  if (i < 0) return 0;
  const b64 = s.slice(i + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/** 写真の枠の値をそろえる（知らない値は null） */
export function normalizeSlot(slot) {
  return PHOTO_SLOT_KEYS.includes(slot) ? slot : null;
}

/**
 * 保存する写真の記録の中身（id・日時の共通項目は db 側で付ける）
 * @param {{brewId:string, slot:string, dataUrl:string, widthPx:number, heightPx:number}} p
 */
export function buildPhoto({ brewId, slot, dataUrl, widthPx, heightPx }) {
  const s = normalizeSlot(slot);
  if (!brewId) throw new Error('抽出が決まっていません');
  if (!s) throw new Error('写真の枠が分かりません');
  if (!isImageDataUrl(dataUrl)) throw new Error('画像を読み取れませんでした');
  return { brewId, slot: s, dataUrl, widthPx: Math.round(widthPx) || null, heightPx: Math.round(heightPx) || null, bytes: dataUrlBytes(dataUrl) };
}

const alive = (r) => r && r.deletedAt == null;
const newer = (a, b) => (String(a.updatedAt ?? '') >= String(b.updatedAt ?? '') ? a : b);

/** その抽出の枠ごとの写真 { grounds, bed, liquid }（ない枠・削除済み・画像が壊れたものは null） */
export function photosOfBrew(photos, brewId) {
  const out = Object.fromEntries(PHOTO_SLOT_KEYS.map((k) => [k, null]));
  for (const p of photos ?? []) {
    if (!alive(p) || p.brewId !== brewId || !normalizeSlot(p.slot) || !isImageDataUrl(p.dataUrl)) continue;
    out[p.slot] = out[p.slot] ? newer(out[p.slot], p) : p;
  }
  return out;
}

/** その抽出の写真の枚数 */
export function photoCount(photos, brewId) {
  return Object.values(photosOfBrew(photos, brewId)).filter(Boolean).length;
}

/** 写真の枚数と合計の大きさ（削除済みは数えない） */
export function photoUsage(photos) {
  const list = (photos ?? []).filter((p) => alive(p) && isImageDataUrl(p.dataUrl));
  return { count: list.length, bytes: list.reduce((sum, p) => sum + dataUrlBytes(p.dataUrl), 0) };
}

/** バイト数を「1.2MB」「350KB」にする */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(0, Math.round(n / 1024))}KB`;
}

/** 書き出しの中身から写真を外す（「写真を含めない」で書き出すとき）。元の中身は変えない */
export function withoutPhotos(backup) {
  return { ...backup, tables: { ...backup.tables, photos: [] } };
}
