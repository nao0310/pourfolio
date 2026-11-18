// ホーム（E1）：保存の促し（G2）、途中の抽出、まだ評価していない1杯、今日の1杯、在庫アラート、豆の飲み頃、直近の抽出
import { isStandalone, registerServiceWorker, requestPersistentStorage } from './pwa.js';
import { installAdvice } from './core/install.js';
import { loadDraft } from './brew-draft.js';
import { openDb, readAll, getSettings, updateSettings, getUnratedBrew } from './db.js';
import { APP_VERSION, versionLabel, whatsNew } from './core/version.js';
import { restockPlan, restockText } from './core/restock.js';
import { brewLine, tastingSummary } from './core/tastings.js';
import { backupReminder, lastBackupText, beanRows, alertText, recentBrews } from './core/home.js';
import { pickPendingSuggestion } from './core/dialin.js';
import { doseFromSettings } from './core/inventory.js';
import { localYmd, formatG } from './core/format.js';
import { STAGES } from './core/freshness.js';
import { $, el, freshnessPill } from './ui.js';

registerServiceWorker();
requestPersistentStorage();

const db = openDb();
const alive = (r) => r && r.deletedAt == null;

const advice = installAdvice({
  userAgent: navigator.userAgent,
  maxTouchPoints: navigator.maxTouchPoints,
  standalone: isStandalone(),
});
$('installCard').hidden = advice !== 'ios-browser';
$('mode').textContent = {
  installed: 'ホーム画面のアプリとして開いています',
  'ios-browser': 'ブラウザで開いています',
  'other-browser': 'ブラウザで開いています（iPhoneでは「共有」→「ホーム画面に追加」で使ってください）',
}[advice];

const draft = loadDraft();
if (draft) {
  $('resumeCard').hidden = false;
  $('resumeLink').href = `brew.html${draft.returnSearch ?? ''}`;
}

const enc = encodeURIComponent;

function renderBackup(settings, all) {
  const hasRecords = all.beans.some(alive) || all.brews.some(alive);
  const r = backupReminder({ lastBackupAt: settings.lastBackupAt, brews: all.brews, hasRecords });
  $('backupCard').hidden = !r.due;
  $('backupReason').textContent = r.reason;
  $('lastBackup').textContent = lastBackupText(settings.lastBackupAt);
}

async function renderUnrated(beanName) {
  const brew = await getUnratedBrew(db);
  if (!brew) return;
  $('unratedText').textContent = [beanName(brew.beanId) || '豆なし', brewLine(brew)].join('　');
  $('unratedLink').href = `tasting.html?brew=${enc(brew.id)}`;
  $('unratedCard').hidden = false;
}

/** 今日の1杯：前回と同じで淹れる（＋その豆のまだ使っていない提案） */
function renderToday(all, beanName) {
  const brews = all.brews.filter(alive).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const last = brews[0];
  const actions = [];
  const link = (href, text, cls = 'btn block') => el('a', { class: cls, href }, text);
  if (last) {
    const recipe = all.recipes.find((r) => r.id === last.recipeId && alive(r));
    const p = last.planned ?? {};
    $('todayText').textContent = [
      '前回：',
      [beanName(last.beanId), recipe?.name ?? p.name, p.doseG != null && p.waterG != null ? `${p.doseG}g・${p.waterG}g` : ''].filter(Boolean).join('　'),
    ].join('');
    const pending = pickPendingSuggestion(all.suggestions, last.beanId);
    if (pending) {
      $('todaySuggest').textContent = `提案：${pending.action.short ?? pending.action.text}`;
      $('todaySuggest').hidden = false;
      actions.push(link(`brew.html?suggestion=${enc(pending.id)}`, '提案を入れて淹れる'));
      actions.push(link('brew.html?from=last', '前回と同じで淹れる', 'btn secondary block'));
    } else {
      actions.push(link('brew.html?from=last', '前回と同じで淹れる'));
    }
    actions.push(link('recipes.html', 'レシピを選んで淹れる', 'btn secondary block'));
  } else if (!all.beans.some(alive)) {
    $('todayText').textContent = 'まず、届いた豆を登録しましょう。';
    actions.push(link('bean-edit.html', '豆を登録する'));
  } else if (!all.recipes.some(alive)) {
    $('todayText').textContent = '次に、レシピを作りましょう。4:6メソッドの雛形があります。';
    actions.push(link('recipe-edit.html', 'レシピを作る'));
  } else {
    $('todayText').textContent = 'レシピを選んで、最初の1杯を淹れましょう。';
    actions.push(link('recipes.html', 'レシピを選んで淹れる'));
  }
  $('todayActions').replaceChildren(...actions);
}

/** 飲み頃の帯（4段階の色＋今日の印） */
function bandNode(row) {
  if (!row.band) return el('p', { class: 'muted small' }, '焙煎日がないので飲み頃は出せません');
  const f = row.freshness;
  return el(
    'div',
    { class: 'band', role: 'img', 'aria-label': `${f.label}。焙煎から${f.days}日` },
    ...row.band.segments.map((s) => el('span', { class: `band-seg stage-${s.stage}`, style: `width:${(s.share * 100).toFixed(2)}%`, title: STAGES[s.stage] })),
    el('span', { class: 'band-mark', style: `left:${(row.band.pos * 100).toFixed(2)}%` }),
  );
}

function renderBeans(rows) {
  const alerts = rows.filter((r) => r.alerts.length);
  $('alertCard').hidden = !alerts.length;
  $('alerts').replaceChildren(
    ...alerts.map((r) =>
      el('li', {}, el('a', { href: `bean.html?id=${enc(r.bean.id)}` }, el('strong', {}, r.bean.name), el('span', { class: 'alert-text' }, alertText(r)))),
    ),
  );

  if (!rows.length) {
    $('beanBands').replaceChildren(
      el('p', { class: 'muted' }, '飲みかけの豆はありません。'),
      el('a', { class: 'btn secondary', href: 'bean-edit.html' }, '＋ 豆を登録'),
    );
    return;
  }
  $('beanBands').replaceChildren(
    ...rows.map((r) => {
      const f = r.freshness;
      const days = f ? (f.days >= 0 ? `焙煎から${f.days}日` : `焙煎まであと${-f.days}日`) : '';
      return el(
        'a',
        { class: 'band-row', href: `bean.html?id=${enc(r.bean.id)}` },
        el('div', { class: 'bean-card-top' }, el('span', { class: 'bean-name' }, r.bean.name), freshnessPill(f)),
        bandNode(r),
        el(
          'div',
          { class: 'band-meta' },
          el('span', { class: 'num' }, `残り ${formatG(Math.max(r.remainingG, 0))}`),
          el('span', {}, `あと${r.cups}杯`),
          days && el('span', { class: 'muted' }, days),
        ),
      );
    }),
  );
}

function renderRecent(all, beanName) {
  const list = recentBrews(all.brews, all.tastings);
  if (!list.length) {
    $('recent').replaceChildren(el('li', { class: 'muted' }, 'まだ抽出の記録はありません。'));
    return;
  }
  $('recent').replaceChildren(
    ...list.map(({ brew, tasting, recordSec }) =>
      el(
        'li',
        {},
        el(
          'a',
          { href: `tasting.html?brew=${enc(brew.id)}` },
          el('span', {}, [beanName(brew.beanId) || '豆なし', brewLine(brew)].join('　')),
          el(
            'span',
            { class: 'muted' },
            [tasting ? tastingSummary(tasting) || 'メモだけ' : '未評価', recordSec != null ? `記録 ${recordSec}秒` : ''].filter(Boolean).join('　'),
          ),
        ),
      ),
    ),
  );
}

/** 更新のあとに一度だけ「Ver ○ になりました」を出す。出したら（出さないときも）今の番号を覚える */
async function renderWhatsNew(settings, all) {
  const hasRecords = all.beans.some(alive) || all.brews.some(alive);
  const news = whatsNew({ lastSeen: settings.lastSeenVersion, hasRecords });
  if (news.show) {
    $('whatsNewTitle').textContent = `${versionLabel(news.version)} になりました`;
    $('whatsNewList').replaceChildren(...news.items.map((t) => el('li', {}, t)));
    $('whatsNewCard').hidden = false;
  }
  if (settings.lastSeenVersion !== APP_VERSION) await updateSettings(db, { lastSeenVersion: APP_VERSION });
}

$('appVersion').textContent = versionLabel();
$('whatsNewClose').addEventListener('click', () => {
  $('whatsNewCard').hidden = true;
});

/** 買い足しの目安：注文の目安日が近い（3日以内・過ぎた）ときだけ出す */
function renderRestock(all, settings) {
  const plan = restockPlan({
    beans: all.beans,
    txs: all.inventoryTx,
    brews: all.brews,
    tastings: all.tastings,
    settings,
    today: localYmd(),
  });
  if (plan.status !== 'now' && plan.status !== 'soon') return;
  const t = restockText(plan);
  $('restockTitle').textContent = t.title;
  $('restockText').textContent = t.text;
  $('restockCard').hidden = false;
}

async function init() {
  const [all, settings] = await Promise.all([readAll(db), getSettings(db)]);
  const beanName = (id) => all.beans.find((b) => b.id === id)?.name ?? '';
  renderBackup(settings, all);
  renderToday(all, beanName);
  renderBeans(beanRows({ beans: all.beans, txs: all.inventoryTx, doseG: doseFromSettings(settings), today: localYmd() }));
  renderRecent(all, beanName);
  renderRestock(all, settings);
  await renderUnrated(beanName);
  await renderWhatsNew(settings, all);
}

init().catch((err) => {
  console.error(err);
  $('todayText').textContent = '記録の読み込みに失敗しました。開き直してください';
});
