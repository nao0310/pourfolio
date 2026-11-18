// 在庫の計算（C2、純粋関数）
// 残量は在庫履歴（InventoryTx）の deltaG を足し合わせて出す。残量そのものは保存しない。

/**
 * 在庫履歴の種類。冷凍・解凍（2-3）は常温と冷凍庫の間で動かした量で、
 * 在庫履歴の合計は「常温の残量」になる（冷凍庫の分は js/core/frozen.js）
 */
export const TX_KINDS = Object.freeze({
  in: '入庫',
  brew: '抽出',
  adjust: '調整（量り直し）',
  gift: 'おすそ分け',
  discard: '廃棄',
  freeze: '冷凍',
  thaw: '冷凍から取り出し',
});

/** 入庫の量に関わる豆の項目。これが変わったときだけ入庫の履歴を直す（2-8の38番） */
export const STOCK_FIELDS = Object.freeze(['actualWeightG', 'labelWeightG', 'labelWeightBasis', 'roastLevel', 'status', 'arrivalDate']);

/** 編集で入庫の量に関わる項目が変わったか */
export function stockFieldsChanged(cur, next) {
  return STOCK_FIELDS.some((k) => (cur?.[k] ?? null) !== (next?.[k] ?? null));
}

/**
 * 「飲み切りを取り消す」で戻す状態（2-8の42番）。
 * 入庫のほかに履歴（抽出・量り直し・冷凍など）があれば開封済み、入庫だけなら未開封
 * @param {object[]} txs その豆の在庫履歴（削除の印が付いたものは除く）
 */
export function statusAfterUnfinish(txs) {
  return (txs ?? []).some((t) => t.deletedAt == null && t.kind !== 'in') ? 'open' : 'unopened';
}

/** 残り杯数の計算に使う1杯の粉の量の初期値（設定 defaultDoseG で変えられる） */
export const DEFAULT_DOSE_G = 15;

/** 消費ペースを見る期間（日） */
export const PACE_WINDOW_DAYS = 14;
/** 消費ペースを出すのに必要な抽出の回数 */
export const PACE_MIN_BREWS = 2;

const round1 = (n) => Math.round(n * 10) / 10;
const alive = (r) => r.deletedAt == null;

/** 設定から1杯の粉の量を読む（なければ初期値） */
export function doseFromSettings(settings) {
  const g = settings?.defaultDoseG;
  return typeof g === 'number' && Number.isFinite(g) && g > 0 ? g : DEFAULT_DOSE_G;
}

/**
 * 残量（g）。削除の印が付いた履歴は数えない。
 * @param {object[]} txs ある豆の在庫履歴
 */
export function remainingG(txs) {
  return round1(txs.filter(alive).reduce((s, t) => s + (Number(t.deltaG) || 0), 0));
}

/** 残り杯数（端数は切り捨て。マイナスにはしない） */
export function cupsLeft(remaining, doseG = DEFAULT_DOSE_G) {
  if (!(doseG > 0) || !(remaining > 0)) return 0;
  // 0.1g単位の誤差で1杯減らないように、わずかに足してから切り捨てる
  return Math.floor(remaining / doseG + 1e-9);
}

/**
 * 直近の消費ペース（抽出で使った量だけを見る）。
 * 見る期間は「期間内の最初の抽出から今まで」で、最短1日・最長 PACE_WINDOW_DAYS 日。
 * @param {object[]} txs
 * @param {Date|string|number} now
 * @returns {{gPerDay:number, brews:number}|null} 抽出が PACE_MIN_BREWS 回未満なら null
 */
export function consumptionPace(txs, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const fromMs = nowMs - PACE_WINDOW_DAYS * 86400000;
  const brews = txs.filter((t) => {
    if (!alive(t) || t.kind !== 'brew') return false;
    const ms = new Date(t.at).getTime();
    return ms >= fromMs && ms <= nowMs;
  });
  if (brews.length < PACE_MIN_BREWS) return null;
  const used = brews.reduce((s, t) => s - (Number(t.deltaG) || 0), 0);
  const firstMs = Math.min(...brews.map((t) => new Date(t.at).getTime()));
  const spanDays = Math.min(PACE_WINDOW_DAYS, Math.max(1, (nowMs - firstMs) / 86400000));
  return { gPerDay: round1(used / spanDays), brews: brews.length };
}

/**
 * なくなるまでの日数と、その日。
 * @returns {{days:number, date:Date}|null} ペースがわからないときは null
 */
export function emptyForecast(remaining, pace, now = new Date()) {
  if (!pace || !(pace.gPerDay > 0)) return null;
  const days = Math.max(0, Math.floor(remaining / pace.gPerDay));
  return { days, date: new Date(new Date(now).getTime() + days * 86400000) };
}

/** 量り直したときに足す調整の量（量った値 − 今の計算上の残量） */
export function adjustDelta(currentG, measuredG) {
  return round1(measuredG - currentG);
}

/** 在庫履歴を豆ごとに分ける { beanId: [tx, …] }（削除の印付きも含む） */
export function groupTxByBean(txs) {
  const out = {};
  for (const t of txs) (out[t.beanId] ??= []).push(t);
  return out;
}

/** 新しい順に並べた在庫履歴（元の配列は変えない） */
export function sortTxNewestFirst(txs) {
  return [...txs].sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}
