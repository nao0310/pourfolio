// 総点検（2-8）：試すデータを、いま開いているポートの保存場所に入れる（中身を全部入れ替える）。
// Browserペインの javascript_tool で：
//   const m = await import('/scripts/debug/load-fixture.js?' + Date.now()); await m.load('demo');
// name は empty・minimal・demo・nasty・bulk。確認用データを壊さないように 8080・8081 では動かない。
export const PORTS = { empty: '8082', minimal: '8083', demo: '8084', nasty: '8085', bulk: '8086' };

export async function load(name) {
  if (['8080', '8081', ''].includes(location.port)) throw new Error(`ポート${location.port || '(なし)'}では入れません（確認用データを守るため）`);
  if (PORTS[name] && PORTS[name] !== location.port) throw new Error(`${name} は ${PORTS[name]} 番で開いてください`);
  const res = await fetch(`/tests/fixtures/debug/${name}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name}.json がありません（node scripts/debug/make-fixtures.js で作る）`);
  const { openDb, clearAll, restoreBackup, countAlive } = await import('/js/db.js');
  const { parseBackup } = await import('/js/core/backup.js');
  const backup = parseBackup(await res.text());
  const db = openDb();
  await clearAll(db);
  await restoreBackup(db, backup);
  const counts = await countAlive(db);
  db.close();
  // 下書き・いつもの表示などの端末の小さな記憶も消す
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
  return counts;
}
