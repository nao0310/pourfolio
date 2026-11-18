// 記録（レコード）の共通のきまり（純粋関数）
// - IDはUUID（設定だけは端末をまたいで1件にまとめるため固定ID）
// - 全記録に createdAt / updatedAt / deletedAt（ISO 8601の文字列）
// - 削除は deletedAt に日時を入れるだけ（ゴミ箱と統合のため）

/** 保存する表の一覧（書き出しファイルにもこの名前で入る） */
export const TABLES = Object.freeze([
  'beans', // Bean 豆（1袋ごと）
  'inventoryTx', // InventoryTx 在庫の増減1件
  'equipment', // Equipment 器具
  'recipes', // Recipe レシピ
  'brews', // Brew 抽出1杯
  'tastings', // Tasting 評価
  'suggestions', // Suggestion 提案ログ（DBの版2で追加）
  'orders', // Order 珈琲問屋への注文1回（DBの版3で追加）
  'frozenPortions', // FrozenPortion 冷凍庫の小分けの袋1つ（DBの版4で追加）
  'photos', // Photo 抽出の写真1枚（DBの版5で追加、A7）
  'experiments', // Experiment 焙煎度比較などの飲み比べ1回（DBの版5で追加、X27）
  'settings', // Settings アプリ全体の設定（1件）
]);

/** 設定の記録のID（どの端末でも同じにして、統合したときに1件にまとまるようにする） */
export const SETTINGS_ID = 'app';

/** 新しいID（UUID） */
export function newId() {
  return globalThis.crypto.randomUUID();
}

const toIso = (now) => (now instanceof Date ? now : new Date(now)).toISOString();

/**
 * 新しい記録を作る。id・createdAt・updatedAt・deletedAt を付ける。
 * @param {object} fields 記録の中身（id を渡すとそれを使う）
 * @param {Date|string|number} [now]
 */
export function createRecord(fields = {}, now = new Date()) {
  const at = toIso(now);
  return {
    ...fields,
    id: fields.id ?? newId(),
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

/**
 * 記録を更新した新しいオブジェクトを返す（元のオブジェクトは変えない）。
 * id と createdAt は変えられない。
 */
export function updateRecord(record, changes = {}, now = new Date()) {
  return {
    ...record,
    ...changes,
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: toIso(now),
  };
}

/** 削除の印を付けた新しいオブジェクトを返す */
export function markDeleted(record, now = new Date()) {
  const at = toIso(now);
  return { ...record, updatedAt: at, deletedAt: at };
}

/** 削除の印が付いていないか */
export const isAlive = (record) => record.deletedAt == null;
