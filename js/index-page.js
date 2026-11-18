// ホーム（E1）：保存の促し（G2）、途中の抽出、まだ評価していない1杯、今日の1杯、在庫アラート、豆の飲み頃、直近の抽出
import { isStandalone, registerServiceWorker, requestPersistentStorage } from './pwa.js';
import { installAdvice } from './core/install.js';
import { loadDraft } from './brew-draft.js';
import { openDb, readAll, getSettings, updateSettings, getUnratedBrew, getCoolPromptBrew } from './db.js';
import { APP_VERSION, versionLabel, whatsNew } from './core/version.js';
import { restockPlan, restockText } from './core/restock.js';
import { brewLine, tastingSummary } from './core/tastings.js';
import { backupReminder, lastBackupText, beanRows, alertText, recentBrews } from './core/home.js';
import { pickPendingSuggestion } from './core/dialin.js';
import { doseFromSettings } from './core/inventory.js';
import { localYmd, formatG } from './core/format.js';
import { STAGES } from './core/freshness.js';
import { openExperiments, experimentStatus, STATUS_LABELS } from './core/compare.js';
import { todayPicks, pickHref } from './core/today.js';
import { MOODS, moodForHour } from './core/plan-adjust.js';
import { analysisRows } from './core/analysis.js';
import { todayCaffeine, caffeineKeeper } from './core/caffeine.js';
import { usualCup, usualReason } from './core/usual.js';
import { autosaveSupported, getAutosaveState, resumeAutosave } from './autosave-file.js';
import { $, el, freshnessPill, frozenPill } from './ui.js';

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

/** 焙煎度の飲み比べ（X27）の途中（いちばん新しい1つ） */
function renderCompare(all) {
  const e = openExperiments(all.experiments)[0];
  if (!e) return;
  $('compareText').textContent = `${e.title}（${STATUS_LABELS[experimentStatus(e)]}）`;
  $('compareLink').href = `compare.html?id=${enc(e.id)}`;
  $('compareCard').hidden = false;
}

/** 冷めた味の評価（B5）：落ち切って15分〜3時間で、冷めてからの評価がまだの1杯 */
async function renderCool(beanName) {
  const brew = await getCoolPromptBrew(db);
  if (!brew) return;
  $('coolText').textContent = [beanName(brew.beanId) || '豆なし', brewLine(brew)].join('　');
  $('coolLink').href = `tasting.html?brew=${enc(brew.id)}&stage=cool`;
  $('coolCard').hidden = false;
}

/**
 * 今日の1杯：おすすめの1位（F3、理由つき）・まだ使っていない提案・前回と同じ。
 * 提案があれば「提案を入れて淹れる」を先に出し（D-059）、なければおすすめを先に出す（D-130）
 */
function renderToday(all, beanName, settings) {
  const now = new Date();
  const brews = all.brews.filter(alive).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const last = brews[0];
  const actions = [];
  const link = (href, text, cls = 'btn block') => el('a', { class: cls, href }, text);

  const mood = moodForHour(now.getHours());
  const rows = beanRows({ beans: all.beans, txs: all.inventoryTx, portions: all.frozenPortions, doseG: doseFromSettings(settings), today: localYmd(now) });
  const caf = todayCaffeine(analysisRows(all), now).mg;
  const pick = todayPicks({ rows, brews: all.brews, tastings: all.tastings, beans: all.beans, now, mood, cutoff: settings.caffeineCutoff ?? null, todayCaffeineMg: caf, n: 1 })[0];
  const pending = last ? pickPendingSuggestion(all.suggestions, last.beanId) : null;

  $('todayPick').hidden = !pick;
  if (pick) {
    $('pickName').textContent = `おすすめ：${pick.bean.name}`;
    $('pickReasons').replaceChildren(...pick.reasons.slice(0, 3).map((t) => el('li', {}, t)));
    $('pickMood').textContent = MOODS[mood] ? `今の時間なので気分「${MOODS[mood].label}」で選びました` : '';
  }

  if (last) {
    const recipe = all.recipes.find((r) => r.id === last.recipeId && alive(r));
    const p = last.planned ?? {};
    $('todayText').textContent = [
      '前回：',
      [beanName(last.beanId), recipe?.name ?? p.name, p.doseG != null && p.waterG != null ? `${p.doseG}g・${p.waterG}g` : ''].filter(Boolean).join('　'),
    ].join('');
    if (pending) {
      $('todaySuggest').textContent = `提案：${pending.action.short ?? pending.action.text}`;
      $('todaySuggest').hidden = false;
      actions.push(link(`brew.html?suggestion=${enc(pending.id)}`, '提案を入れて淹れる'));
    }
    if (pick) actions.push(link(pickHref(pick), 'おすすめで淹れる', pending ? 'btn secondary block' : 'btn block'));
    actions.push(link('brew.html?from=last', '前回と同じで淹れる', pending || pick ? 'btn secondary block' : 'btn block'));
    actions.push(link('recipes.html', 'レシピを選んで淹れる', 'btn secondary block'));
  } else if (!all.beans.some(alive)) {
    $('todayText').textContent = 'まず、届いた豆を登録しましょう。';
    actions.push(link('bean-edit.html', '豆を登録する'));
  } else {
    $('todayText').textContent = all.recipes.some(alive)
      ? 'レシピを選んで、最初の1杯を淹れましょう。'
      : 'おすすめの豆を、似た豆や焙煎度から決めた最初のレシピ（4:6メソッド）で淹れられます。';
    if (pick) actions.push(link(pickHref(pick), 'おすすめで淹れる'));
    actions.push(link(all.recipes.some(alive) ? 'recipes.html' : 'recipe-edit.html', all.recipes.some(alive) ? 'レシピを選んで淹れる' : 'レシピを作る', pick ? 'btn secondary block' : 'btn block'));
  }
  if (pick) actions.push(el('a', { class: 'link-more', href: 'today.html' }, 'ほかの候補・気分を変える'));
  $('todayActions').replaceChildren(...actions);
}

/** いつもの1杯（X15）。決まらないとき（レシピで淹れた杯がない）は出さない */
function renderUsual(all, beanName, settings) {
  const now = new Date();
  const rows = beanRows({ beans: all.beans, txs: all.inventoryTx, portions: all.frozenPortions, doseG: doseFromSettings(settings), today: localYmd(now) });
  const u = usualCup({ brews: all.brews, tastings: all.tastings, recipes: all.recipes, usableBeanIds: rows.filter((r) => r.cups >= 1).map((r) => r.bean.id), now });
  $('usualCard').hidden = !u;
  if (!u) return;
  $('usualLink').href = u.href;
  $('usualLabel').textContent = u.allDay ? 'いつもの1杯で淹れる' : `いつもの1杯（${u.band.label}）で淹れる`;
  $('usualWhat').textContent = [u.recipe.name, u.beanId ? beanName(u.beanId) : '豆は選んでから'].filter(Boolean).join('・');
  $('usualWhy').textContent = usualReason(u);
}

/** カフェイン・タイムキーパー（X17）。淹れた記録があるか、控える時刻を決めたときに出す */
function renderCaffeine(all, settings) {
  const now = new Date();
  const cutoff = settings.caffeineCutoff ?? null;
  if (!all.brews.some(alive) && !cutoff) return;
  const { mg, unknown } = todayCaffeine(analysisRows(all), now);
  const k = caffeineKeeper({ now, cutoff, mg });
  $('cafMain').textContent = k.main;
  $('cafFill').style.width = `${k.pct}%`;
  $('cafFill').classList.toggle('over', k.late);
  $('cafMeter').setAttribute('aria-label', `目安の${k.pct}%`);
  $('cafSub').textContent = `${k.sub}${unknown ? `（量のわからない${unknown}杯を除く）` : ''}`;
  $('cafCard').hidden = false;
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
      const days = r.frozenOnly ? '' : f ? (f.days >= 0 ? `焙煎から${f.days}日` : `焙煎まであと${-f.days}日`) : '';
      return el(
        'a',
        { class: 'band-row', href: `bean.html?id=${enc(r.bean.id)}` },
        el('div', { class: 'bean-card-top' }, el('span', { class: 'bean-name' }, r.bean.name), r.frozenOnly ? frozenPill() : freshnessPill(f)),
        !r.frozenOnly && bandNode(r),
        el(
          'div',
          { class: 'band-meta' },
          el('span', { class: 'num' }, `残り ${formatG(Math.max(r.remainingG, 0))}`),
          el('span', {}, `あと${r.cups}杯`),
          r.frozenCount > 0 && el('span', { class: 'muted' }, `冷凍${r.frozenCount}袋を含む`),
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
    portions: all.frozenPortions,
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

/** 自動ファイル保存（X1）が止まっていれば、再開のボタン（許可を聞くのでボタンで） */
async function renderAutosave() {
  if (!autosaveSupported()) return;
  const st = await getAutosaveState();
  $('autosaveCard').hidden = !(st.on && st.needsPermission);
  $('autosaveText').textContent = 'ブラウザを開き直すと、フォルダに書き込む許可がいったん切れます。';
}

$('autosaveResume').addEventListener('click', async () => {
  try {
    if (await resumeAutosave(db)) $('autosaveCard').hidden = true;
  } catch (err) {
    console.error(err);
    $('autosaveText').textContent = '再開できませんでした。「その他」→「データ」でフォルダを選び直してください。';
  }
});

async function init() {
  const [all, settings] = await Promise.all([readAll(db), getSettings(db)]);
  const beanName = (id) => all.beans.find((b) => b.id === id)?.name ?? '';
  renderBackup(settings, all);
  renderUsual(all, beanName, settings);
  renderToday(all, beanName, settings);
  renderCaffeine(all, settings);
  renderBeans(beanRows({ beans: all.beans, txs: all.inventoryTx, portions: all.frozenPortions, doseG: doseFromSettings(settings), today: localYmd() }));
  renderRecent(all, beanName);
  renderRestock(all, settings);
  await renderUnrated(beanName);
  await renderCool(beanName);
  renderCompare(all);
  await renderWhatsNew(settings, all);
  await renderAutosave().catch((err) => console.error(err));
}

init().catch((err) => {
  console.error(err);
  $('todayText').textContent = '記録の読み込みに失敗しました。開き直してください';
});
