// 総点検（2-8）：データのつじつまチェック。アプリには含めない。
// - ブラウザ（Browserペインの javascript_tool）：
//     const m = await import('/scripts/debug/consistency.js?' + Date.now()); await m.checkBrowser()
// - Node（試すデータのファイル）：node scripts/debug/consistency.js tests/fixtures/debug/nasty.json
// 返すもの：[{ level: '問題'|'注意', table, id, text }]

const alive = (r) => r && r.deletedAt == null;
const round1 = (n) => Math.round(n * 10) / 10;

/** @param {Record<string, object[]>} tables 書き出しファイルの tables と同じ形 */
export function check(tables) {
  const out = [];
  const add = (level, table, id, text) => out.push({ level, table, id, text });
  const t = (name) => tables[name] ?? [];
  const byId = (name) => new Map(t(name).map((r) => [r.id, r]));
  const beans = byId('beans');
  const brews = byId('brews');
  const tastings = t('tastings');
  const txs = t('inventoryTx');

  // 共通の項目
  for (const [name, rows] of Object.entries(tables)) {
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.id)) add('問題', name, r.id, '同じIDが2件ある');
      seen.add(r.id);
      for (const k of ['createdAt', 'updatedAt']) if (!r[k] || Number.isNaN(Date.parse(r[k]))) add('問題', name, r.id, `${k} がない・日時でない`);
      if (!('deletedAt' in r)) add('注意', name, r.id, 'deletedAt の項目がない');
      if (r.createdAt && r.updatedAt && r.updatedAt < r.createdAt) add('注意', name, r.id, 'updatedAt が createdAt より前');
    }
  }

  // 在庫：豆ごとの常温の残り
  const roomG = new Map();
  for (const x of txs.filter(alive)) {
    if (!Number.isFinite(x.deltaG)) add('問題', 'inventoryTx', x.id, `deltaG が数でない（${x.deltaG}）`);
    roomG.set(x.beanId, round1((roomG.get(x.beanId) ?? 0) + (Number(x.deltaG) || 0)));
    const b = beans.get(x.beanId);
    if (!b) add('問題', 'inventoryTx', x.id, '豆がない在庫の履歴');
    else if (!alive(b)) add('問題', 'inventoryTx', x.id, `削除した豆（${b.name}）の在庫の履歴が残っている`);
    if (x.brewId) {
      const br = brews.get(x.brewId);
      if (!br) add('問題', 'inventoryTx', x.id, '抽出がない在庫の履歴（brewId の先がない）');
      else if (!alive(br)) add('注意', 'inventoryTx', x.id, '削除した抽出の在庫の履歴が残っている（粉の分が戻らない）');
    }
  }
  const portions = t('frozenPortions');
  const inFreezer = (p) => alive(p) && p.takenOutAt == null;
  for (const b of t('beans').filter(alive)) {
    const room = roomG.get(b.id) ?? 0;
    const frozen = round1(portions.filter((p) => inFreezer(p) && p.beanId === b.id).reduce((s, p) => s + p.grams, 0));
    if (room < -0.05) add('問題', 'beans', b.id, `常温の残りがマイナス（${room}g）：${b.name}`);
    if (b.status === 'ordered' && room !== 0) add('問題', 'beans', b.id, `入荷待ちなのに在庫がある（${room}g）：${b.name}`);
    if (b.status !== 'ordered' && b.status !== 'finished' && room <= 0 && frozen === 0) add('注意', 'beans', b.id, `残り0gなのに「${b.status}」のまま：${b.name}`);
    if (b.status === 'finished' && frozen > 0) add('注意', 'beans', b.id, `飲み切りなのに冷凍庫に${frozen}g：${b.name}`);
    if (b.roastDate && b.roastDate > new Date().toISOString().slice(0, 10)) add('注意', 'beans', b.id, `焙煎日が未来（${b.roastDate}）：${b.name}`);
  }
  for (const p of portions.filter(alive)) {
    const b = beans.get(p.beanId);
    if (!b || !alive(b)) add('問題', 'frozenPortions', p.id, '削除した豆・ない豆の冷凍の袋');
    if (p.takenOutAt && !txs.some((x) => alive(x) && x.kind === 'thaw' && x.portionId === p.id)) add('問題', 'frozenPortions', p.id, '取り出したのに「取り出し」の在庫の履歴がない');
    if (!(p.grams > 0)) add('問題', 'frozenPortions', p.id, `袋の量がおかしい（${p.grams}）`);
  }

  // 抽出
  for (const br of t('brews').filter(alive)) {
    const a = br.actual ?? {};
    if (!(a.doseG > 0) || !(a.waterG > 0)) add('問題', 'brews', br.id, `粉量・湯量がおかしい（${a.doseG}g・${a.waterG}g）`);
    if (br.derived && br.derived.ratio != null && !Number.isFinite(br.derived.ratio)) add('問題', 'brews', br.id, `比率が数でない（${br.derived.ratio}）`);
    if (Number.isNaN(Date.parse(br.at))) add('問題', 'brews', br.id, `淹れた日時がない（${br.at}）`);
    if (br.beanId) {
      const b = beans.get(br.beanId);
      if (!b) add('問題', 'brews', br.id, '豆がない抽出（beanId の先がない）');
      else if (alive(b) && b.status !== 'ordered' && !txs.some((x) => alive(x) && x.brewId === br.id && x.kind === 'brew')) add('注意', 'brews', br.id, '在庫から粉を引いた履歴がない');
    }
    if (br.recipeId && !byId('recipes').get(br.recipeId)) add('注意', 'brews', br.id, 'レシピがない抽出（recipeId の先がない）');
    const ts = tastings.filter((x) => alive(x) && x.brewId === br.id);
    const keys = ts.map((x) => `${x.by ?? 'me'}|${x.stage ?? 'warm'}`);
    if (new Set(keys).size !== keys.length) add('問題', 'brews', br.id, `同じ人・同じ温度帯の評価が${keys.length - new Set(keys).size + 1}件`);
  }

  // 評価・提案・写真・飲み比べ：つながりの先
  const brewLink = (table, rows, key, text) => {
    for (const r of rows.filter(alive)) {
      const id = r[key];
      if (!id) continue;
      const br = brews.get(id);
      if (!br) add('問題', table, r.id, `${text}（${key} の先がない）`);
      else if (!alive(br)) add('注意', table, r.id, `${text}（${key} の先が削除済み）`);
    }
  };
  brewLink('tastings', tastings, 'brewId', '杯のない評価');
  brewLink('suggestions', t('suggestions'), 'brewId', '杯のない提案');
  brewLink('suggestions', t('suggestions'), 'nextBrewId', '次の杯のない提案');
  brewLink('photos', t('photos'), 'brewId', '杯のない写真');
  for (const x of tastings.filter(alive)) {
    if (x.stars != null && !(x.stars >= 1 && x.stars <= 5)) add('問題', 'tastings', x.id, `★がおかしい（${x.stars}）`);
  }
  for (const e of t('experiments').filter(alive)) {
    for (const en of e.entries ?? []) {
      if (!beans.get(en.beanId)) add('問題', 'experiments', e.id, '飲み比べの袋がない');
      if (en.brewId && !brews.get(en.brewId)) add('問題', 'experiments', e.id, '飲み比べの杯がない');
    }
  }
  for (const r of t('recipes').filter(alive)) {
    if (!(r.doseG > 0) || !(r.waterG > 0)) add('問題', 'recipes', r.id, `粉量・湯量がおかしい：${r.name}`);
    const last = (r.pours ?? []).at(-1);
    if (last && Math.abs(last.toG - r.waterG) > 0.5) add('注意', 'recipes', r.id, `最後の注湯（${last.toG}g）と湯量（${r.waterG}g）が合わない：${r.name}`);
  }
  return out;
}

/** いま開いているポートの保存場所を調べる */
export async function checkBrowser() {
  const { openDb, readAll } = await import('/js/db.js');
  const db = openDb();
  const tables = await readAll(db);
  db.close();
  return check(tables);
}

// Node で直接動かしたとき
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('consistency.js')) {
  const { readFile } = await import('node:fs/promises');
  for (const file of process.argv.slice(2)) {
    const data = JSON.parse(await readFile(file, 'utf8'));
    const res = check(data.tables);
    console.log(`\n${file}：${res.length}件`);
    for (const r of res) console.log(`  [${r.level}] ${r.table} ${r.id.slice(0, 8)} ${r.text}`);
  }
}
