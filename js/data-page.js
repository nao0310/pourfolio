// データの書き出しと復元の画面（G1）
import { openDb, countAlive, exportAll, restoreBackup, clearAll, putAll, updateSettings, readAll, getSettings } from './db.js';
import { toCsv, brewRows, beanRowsCsv, csvFileName } from './core/csv.js';
import { doseFromSettings } from './core/inventory.js';
import { localYmd } from './core/format.js';
import { parseBackup, backupFileName, totalRecords, BackupError } from './core/backup.js';
import { makeSampleData } from './core/sample-data.js';
import { makeDemoData } from './core/demo-data.js';
import { TABLES, SETTINGS_ID } from './core/records.js';
import { formatDateTimeJa } from './core/format.js';
import { registerServiceWorker, requestPersistentStorage, getOfflineStatus } from './pwa.js';
import { APP_VERSION, CHANGELOG, versionLabel } from './core/version.js';
import { photoUsage, formatBytes, withoutPhotos } from './core/photos.js';

const LABELS = {
  beans: '豆',
  inventoryTx: '在庫の履歴',
  equipment: '器具',
  recipes: 'レシピ',
  brews: '抽出',
  tastings: '評価',
  suggestions: '提案',
  orders: '注文',
  frozenPortions: '冷凍の袋',
  photos: '写真',
  experiments: '飲み比べ',
  settings: '設定',
};

const db = openDb();
const $ = (id) => document.getElementById(id);

function showMessage(text, kind = 'ok') {
  const el = $('msg');
  el.textContent = text;
  el.className = kind;
}

async function render() {
  const counts = await countAlive(db);
  const dl = $('counts');
  dl.replaceChildren();
  for (const name of TABLES) {
    if (name === 'settings') continue;
    const dt = document.createElement('dt');
    dt.textContent = LABELS[name];
    const dd = document.createElement('dd');
    dd.textContent = `${counts[name]} 件`;
    dl.append(dt, dd);
  }
  const usage = photoUsage(await db.table('photos').toArray());
  $('photoUsage').textContent = usage.count ? `写真 ${usage.count}枚・約${formatBytes(usage.bytes)}` : '';
  $('noPhotosRow').hidden = usage.count === 0;
  const s = await db.table('settings').get(SETTINGS_ID);
  $('lastBackup').textContent = s?.lastBackupAt
    ? `最後に書き出した日時：${formatDateTimeJa(s.lastBackupAt)}`
    : 'まだ書き出していません';
}

/** iPhoneなどタッチ端末で、ファイルを共有シートで渡せるか */
function canShareFile(...files) {
  return (
    window.matchMedia('(pointer: coarse)').matches &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files })
  );
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$('export').addEventListener('click', async () => {
  try {
    const now = new Date();
    const all = await exportAll(db, now);
    // 「写真を含めない」：ファイルを小さくしたいとき。写真は復元で戻らない（D-108）
    const backup = !$('noPhotosRow').hidden && $('noPhotos').checked ? withoutPhotos(all) : all;
    const file = new File([JSON.stringify(backup, null, 1)], backupFileName(now), { type: 'application/json' });
    if (canShareFile(file)) {
      try {
        await navigator.share({ files: [file], title: 'Pourfolioのバックアップ' });
      } catch (err) {
        if (err.name === 'AbortError') {
          showMessage('書き出しをやめました', 'muted');
          return;
        }
        throw err;
      }
    } else {
      download(file);
    }
    await updateSettings(db, { lastBackupAt: now.toISOString() }, now);
    showMessage(`書き出しました（${file.name}）`);
    await render();
  } catch (err) {
    console.error(err);
    showMessage('書き出しに失敗しました', 'error');
  }
});

// 表計算用のCSV（G1）。復元には使えないので、最後に書き出した日時は変えない
$('exportCsv').addEventListener('click', async () => {
  try {
    const now = new Date();
    const [all, settings] = await Promise.all([readAll(db), getSettings(db)]);
    const brews = toCsv(
      brewRows({
        brews: all.brews,
        beans: all.beans,
        recipes: all.recipes,
        equipment: all.equipment,
        tastings: all.tastings,
        suggestions: all.suggestions,
        photos: all.photos,
        experiments: all.experiments,
      }),
    );
    const beans = toCsv(beanRowsCsv({ beans: all.beans, txs: all.inventoryTx, portions: all.frozenPortions, doseG: doseFromSettings(settings), today: localYmd(now) }));
    const type = 'text/csv';
    const files = [new File([brews], csvFileName('brews', now), { type }), new File([beans], csvFileName('beans', now), { type })];
    if (canShareFile(...files)) {
      try {
        await navigator.share({ files, title: 'Pourfolioの記録（CSV）' });
      } catch (err) {
        if (err.name === 'AbortError') {
          showMessage('書き出しをやめました', 'muted');
          return;
        }
        throw err;
      }
    } else {
      files.forEach((f, i) => setTimeout(() => download(f), i * 300)); // 続けてダウンロードすると止められるブラウザがあるので少し空ける
    }
    showMessage(`CSVを書き出しました（${files.map((f) => f.name).join('、')}）`);
  } catch (err) {
    console.error(err);
    showMessage('CSVの書き出しに失敗しました', 'error');
  }
});

$('file').addEventListener('change', async (event) => {
  const input = event.target;
  const file = input.files?.[0];
  input.value = ''; // 同じファイルをもう一度選べるようにする
  if (!file) return;
  try {
    const backup = parseBackup(await file.text());
    const total = totalRecords(backup.tables);
    if (total === 0) {
      showMessage('このファイルには記録が入っていませんでした。何も変わっていません', 'muted');
      return;
    }
    const when = formatDateTimeJa(backup.exportedAt) || '不明';
    if (!confirm(`${when} に書き出したファイル（${total} 件）を復元します。よろしいですか？`)) return;
    const result = await restoreBackup(db, backup);
    const added = TABLES.reduce((n, name) => n + result[name].added, 0);
    const updated = TABLES.reduce((n, name) => n + result[name].updated, 0);
    const skipped = TABLES.reduce((n, name) => n + result[name].skipped, 0);
    showMessage(`復元しました（追加 ${added} 件・更新 ${updated} 件・変更なし ${skipped} 件）`);
    await render();
  } catch (err) {
    console.error(err);
    showMessage(err instanceof BackupError ? err.message : '復元に失敗しました', 'error');
  }
});

$('clear').addEventListener('click', async () => {
  if (!confirm('この端末の記録をすべて消します。よろしいですか？')) return;
  if (!confirm('本当に消しますか？ 元に戻せません。')) return;
  // 設定もここでは作り直さない（作り直すと、復元したときにファイルの設定より新しいと判定されてしまう）
  await clearAll(db);
  showMessage('全部消しました');
  await render();
});

// 開発用：手元のサーバー（localhost）か、URLに ?dev を付けたときだけ表示
const isDev = ['localhost', '127.0.0.1'].includes(location.hostname) || new URLSearchParams(location.search).has('dev');
if (isDev) {
  $('devTools').hidden = false;
  $('sample').addEventListener('click', async () => {
    await putAll(db, makeSampleData());
    showMessage('サンプルを入れました');
    await render();
  });
  $('demoData').addEventListener('click', async () => {
    if (!confirm('分析のデモデータ（豆8袋・80杯）をこの端末のデータに入れますか？あとで1件ずつ消すのは大変です')) return;
    await putAll(db, makeDemoData());
    showMessage('デモデータを入れました');
    await render();
  });
}

/** 更新履歴（新しい順） */
function renderChangelog() {
  const box = $('changelog');
  box.replaceChildren();
  for (const e of CHANGELOG) {
    const h = document.createElement('h3');
    const [y, m, d] = e.date.split('-').map(Number);
    h.textContent = `${versionLabel(e.version)}（${y}/${m}/${d}）`;
    const ul = document.createElement('ul');
    for (const item of e.items) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.append(li);
    }
    box.append(h, ul);
  }
}

/** オフラインの準備の状況と、アプリの版（G3） */
async function renderOffline() {
  const st = await getOfflineStatus().catch(() => null);
  let text;
  if (!st?.supported) text = 'この開き方ではオフラインで使えません（GitHub Pages のアドレスで開いてください）';
  else if (st.ready) text = '準備済み：通信がなくても開けます';
  else text = '準備中：通信できる場所で、一度アプリを開き直してください';
  $('offlineStatus').textContent = text;
  // 番号のあとの英数字は、ファイルがそろっているかを確かめるための指紋
  $('appVersionLabel').textContent = st?.version ? `${versionLabel()}（${st.version.slice(0, 8)}）` : versionLabel();
  $('appVersion').textContent = st?.updateWaiting
    ? `新しい版${st.waitingLabel ? `（${versionLabel(st.waitingLabel)}）` : ''}が準備できています（画面の上の「更新する」で切り替わります）`
    : '';
}

$('appVersionLabel').textContent = versionLabel(APP_VERSION);
renderChangelog();
registerServiceWorker().then(() => navigator.serviceWorker?.ready).then(renderOffline, renderOffline);
requestPersistentStorage();
render().catch((err) => {
  console.error(err);
  showMessage('記録の読み込みに失敗しました', 'error');
});
