// データの書き出しと復元の画面（G1）
import { openDb, countAlive, exportAll, restoreBackup, clearAll, putAll, setDeviceSettings, readAll, getSettings } from './db.js';
import { toCsv, brewRows, beanRowsCsv, csvFileName } from './core/csv.js';
import { doseFromSettings } from './core/inventory.js';
import { localYmd } from './core/format.js';
import { parseBackup, backupFileName, totalRecords, BackupError, withBackupAt, TABLE_LABELS } from './core/backup.js';
import { makeSampleData } from './core/sample-data.js';
import { makeDemoData } from './core/demo-data.js';
import { TABLES, SETTINGS_ID } from './core/records.js';
import { formatDateTimeJa } from './core/format.js';
import { registerServiceWorker, requestPersistentStorage, getOfflineStatus } from './pwa.js';
import { APP_VERSION, CHANGELOG, versionLabel } from './core/version.js';
import { photoUsage, formatBytes, withoutPhotos } from './core/photos.js';
import { autosaveSupported, getAutosaveState, chooseFolder, resumeAutosave, stopAutosave } from './autosave-file.js';
import { askConfirm } from './confirm-box.js';
import { isQuotaError } from './core/errors.js';
import { singleFlight } from './core/once.js';

const LABELS = TABLE_LABELS;

/** 処理中はボタンを押せなくし、2回目を受け付けない（書き出しの2度押しでファイルが2つにならないように、総仕上げの77番） */
function onceWhileRunning(id, fn) {
  const run = singleFlight(fn);
  return async () => {
    const btn = document.getElementById(id);
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    try {
      await run();
    } finally {
      // 書き出しはすぐ終わるので、終わってから1.5秒も押せないままにする（2度押しの2回目が新しい書き出しにならないように）
      setTimeout(() => btn && (btn.disabled = false), 1500);
    }
  };
}

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

$('export').addEventListener('click', onceWhileRunning('export', async () => {
  try {
    const now = new Date();
    const all = withBackupAt(await exportAll(db, now), now);
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
    await setDeviceSettings(db, { lastBackupAt: now.toISOString() }); // 設定の updatedAt は進めない（58番）
    showMessage(`書き出しました（${file.name}）`);
    await render();
  } catch (err) {
    console.error(err);
    showMessage('書き出せませんでした。もう一度押してください', 'error');
  }
}));

// 表計算用のCSV（G1）。復元には使えないので、最後に書き出した日時は変えない
$('exportCsv').addEventListener('click', onceWhileRunning('exportCsv', async () => {
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
    showMessage('CSVを書き出せませんでした。もう一度押してください', 'error');
  }
}));

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
    if (!(await askConfirm(`${when} に書き出したファイル（${total} 件）を復元しますか？`, { ok: '復元する' }))) return;
    const result = await restoreBackup(db, backup);
    const added = TABLES.reduce((n, name) => n + result[name].added, 0);
    const updated = TABLES.reduce((n, name) => n + result[name].updated, 0);
    const skipped = TABLES.reduce((n, name) => n + result[name].skipped, 0);
    showMessage(`復元しました（追加 ${added} 件・更新 ${updated} 件・変更なし ${skipped} 件）`);
    await render();
  } catch (err) {
    console.error(err);
    // 空きが足りないときは、ファイルのせいに読めないように分ける（総仕上げの61番。復元は1つのまとまりなので途中までは入らない）
    const text = err instanceof BackupError ? err.message : isQuotaError(err) ? '端末の保存の空きが足りないため、復元できませんでした（記録は変わっていません）。空きを作ってから、もう一度選んでください' : '復元できませんでした。ファイルを確かめて、もう一度選んでください';
    showMessage(text, 'error');
  }
});

$('clear').addEventListener('click', async () => {
  if (!(await askConfirm('この端末の記録をすべて削除しますか？', { ok: '削除する', danger: true }))) return;
  if (!(await askConfirm('本当に削除しますか？元に戻せません', { ok: 'すべて削除する', danger: true }))) return;
  // 設定もここでは作り直さない（作り直すと、復元したときにファイルの設定より新しいと判定されてしまう）
  await clearAll(db);
  // 自動ファイル保存も止める。続けると、復元する前の保存でフォルダのファイルが空の中身に替わるため（2-8 の18番）
  let stopped = false;
  if (autosaveSupported() && (await getAutosaveState().catch(() => null))?.on) {
    await stopAutosave().catch((err) => console.error(err));
    stopped = true;
  }
  showMessage(stopped ? 'すべて削除しました。自動ファイル保存も止めました（フォルダのファイルはそのまま残っています）' : 'すべて削除しました');
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
    if (!(await askConfirm('分析のデモデータ（豆8袋・80杯・気になる豆3つ）をこの端末のデータに入れますか？あとで1件ずつ消すのは大変です', { ok: '入れる' }))) return;
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

// ---- 自動ファイル保存（X1）：PC の Chrome・Edge だけ ----

async function renderAutosave() {
  const st = await getAutosaveState();
  $('autosaveCard').hidden = !st.show;
  if (!st.show) return;
  $('autosaveText').textContent = st.text;
  $('autosaveChoose').textContent = st.on ? 'フォルダを選び直す' : 'フォルダを選ぶ';
  $('autosaveChoose').className = st.on ? 'btn secondary' : 'btn';
  $('autosaveResume').hidden = !(st.on && st.needsPermission);
  $('autosaveStop').hidden = !st.on;
}

async function autosaveAction(fn, okText) {
  try {
    const ok = await fn();
    if (ok !== false) showMessage(okText);
  } catch (err) {
    if (err?.name === 'AbortError') return; // フォルダを選ばずに閉じた
    console.error(err);
    showMessage('フォルダに保存できませんでした。別のフォルダを選んでください', 'error');
  }
  await renderAutosave();
  await render();
}

if (autosaveSupported()) {
  $('autosaveChoose').addEventListener('click', () => autosaveAction(() => chooseFolder(db), 'フォルダに保存しました。これから保存のたびに上書きします'));
  $('autosaveResume').addEventListener('click', () => autosaveAction(() => resumeAutosave(db), '自動保存を再開しました'));
  $('autosaveStop').addEventListener('click', () => autosaveAction(() => stopAutosave(), '自動保存をやめました（フォルダのファイルは残っています）'));
  renderAutosave().catch((err) => console.error(err));
}

$('appVersionLabel').textContent = versionLabel(APP_VERSION);
renderChangelog();
// 準備がいつまでも終わらないときも「確かめています…」のままにせず、5秒で今の状況を出す（2-8の49番）
const swReady = registerServiceWorker().then(() => navigator.serviceWorker?.ready);
Promise.race([swReady, new Promise((resolve) => setTimeout(resolve, 5000))]).then(renderOffline, renderOffline);
swReady.then(renderOffline, () => {}); // 5秒より遅れて準備できたら、出し直す
requestPersistentStorage();
render().catch((err) => {
  console.error(err);
  // 件数の「読み込み中…」を残さない（2-8の45番）
  const dt = document.createElement('dt');
  dt.className = 'error';
  dt.textContent = '件数を読み込めませんでした';
  $('counts').replaceChildren(dt, document.createElement('dd'));
  showMessage('記録を読み込めませんでした。開き直してください', 'error');
});
