// トップ画面：途中の抽出と、まだ評価していない1杯の案内
import { isStandalone, registerServiceWorker } from './pwa.js';
import { loadDraft } from './brew-draft.js';
import { openDb, getUnratedBrew, getBeanWithTx } from './db.js';
import { brewLine } from './core/tastings.js';
import { $ } from './ui.js';

registerServiceWorker();

const draft = loadDraft();
if (draft) {
  $('resumeCard').hidden = false;
  $('resumeLink').href = `brew.html${draft.returnSearch ?? ''}`;
}

$('mode').textContent = isStandalone()
  ? 'ホーム画面のアプリとして開いています'
  : 'ブラウザで開いています（iPhoneでは「共有」→「ホーム画面に追加」で使ってください）';

async function showUnrated() {
  const db = openDb();
  const brew = await getUnratedBrew(db);
  if (!brew) return;
  const bean = brew.beanId ? (await getBeanWithTx(db, brew.beanId))?.bean : null;
  $('unratedText').textContent = [bean?.name ?? '豆なし', brewLine(brew)].join('　');
  $('unratedLink').href = `tasting.html?brew=${encodeURIComponent(brew.id)}`;
  $('unratedCard').hidden = false;
}

showUnrated().catch((err) => console.error(err));
