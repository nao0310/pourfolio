// 抽出の画面：計画（A1）→ ガイド付きタイマー（A2・A3）→ 実績の確認（A4）→ 保存 → 味の評価（tasting.html）
// 途中の状態は下書き（js/brew-draft.js）に残し、画面を開き直しても続きから進める。
import { openDb, getRecipe, getLastBrew, listBeans, listEquipment, getSettings, updateSettings, saveBrew } from './db.js';
import { planFromRecipe, planFromBrew, formatSec, POUR_STYLES } from './core/recipes.js';
import { sortBeansForList } from './core/beans.js';
import { formatG } from './core/format.js';
import { timerView, cuesBetween, addLap, autoAdvance, pourName, pourEndSec } from './core/timer.js';
import {
  newDraft,
  elapsedSec,
  finishDraft,
  initialActualInput,
  normalizeActualInput,
  brewDiff,
  diffLines,
  buildBrew,
} from './core/brews.js';
import { loadDraft, saveDraft, clearDraft } from './brew-draft.js';
import * as cue from './cue.js';
import { createWakeLock } from './wake-lock.js';
import { $, el, queryParam, showMessage, stepperField } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
let draft = null;
let beans = [];
let speechOn = true;
let loadedPlan = null;

// ---- 計画（スタート前） ----

/** URL（?recipe=ID または ?from=last）から計画を作る。見つからなければ null */
async function loadPlan() {
  const recipeId = queryParam('recipe');
  if (recipeId) {
    const recipe = await getRecipe(db, recipeId);
    return recipe ? { plan: planFromRecipe(recipe), recipe } : null;
  }
  if (queryParam('from') === 'last') {
    const last = await getLastBrew(db);
    if (!last) return null;
    const recipe = last.recipeId ? await getRecipe(db, last.recipeId) : null;
    return { plan: planFromBrew(last, recipe), recipe };
  }
  return null;
}

function planItem(label, value) {
  return el('div', { class: 'plan-item' }, el('span', { class: 'muted' }, label), el('span', { class: 'num plan-value' }, value || '—'));
}

/** 豆の選択肢（飲み切り以外） */
function fillBeanSelect(select, selectedId) {
  const usable = sortBeansForList(beans).filter((b) => b.status !== 'finished' || b.id === selectedId);
  select.replaceChildren(
    el('option', { value: '' }, usable.length ? '（選ばない）' : '（豆が未登録）'),
    ...usable.map((b) => el('option', { value: b.id }, [b.name, b.roastLevel].filter(Boolean).join('　'))),
  );
  select.value = usable.some((b) => b.id === selectedId) ? selectedId : '';
  return usable;
}

async function showPlan(loaded, lastBeanId) {
  const { plan, recipe } = loaded;
  const equipment = await listEquipment(db);
  const eqName = (id) => equipment.find((e) => e.id === id)?.name ?? '';

  $('content').hidden = false;
  $('name').textContent = plan.source === 'lastBrew' ? `前回と同じ：${recipe?.name ?? plan.name}` : plan.name;
  document.title = `${$('name').textContent} - Pourfolio`;
  $('sub').textContent = plan.source === 'lastBrew' ? '前回の抽出の計画を写しました' : `レシピ 版${plan.recipeVersion}`;
  if (plan.recipeId && recipe) $('editLink').href = `recipe-edit.html?id=${encodeURIComponent(plan.recipeId)}`;
  else $('editLink').hidden = true;

  // 豆：初期値は前回の豆（なければ一覧の先頭）
  const preferred = plan.beanId ?? lastBeanId ?? null;
  const usable = fillBeanSelect($('bean'), preferred);
  if (!$('bean').value && usable[0]) $('bean').value = usable[0].id;
  $('beanNote').textContent = preferred && $('bean').value === preferred ? '前回の豆を選んでいます' : '';

  $('plan').replaceChildren(
    planItem('粉量', formatG(plan.doseG)),
    planItem('湯量', formatG(plan.waterG)),
    planItem('比率', plan.ratio ? `1:${plan.ratio}` : ''),
    planItem('湯温', plan.tempC != null ? `${plan.tempC}℃` : ''),
    planItem('挽き目', plan.grind?.setting ?? ''),
    planItem('目標時間', formatSec(plan.targetTotalSec)),
  );
  const equipRows = [
    ['グラインダー', eqName(plan.grind?.grinderId)],
    ['ドリッパー', eqName(plan.equipment?.dripperId)],
    ['フィルター', eqName(plan.equipment?.filterId)],
    ['ケトル', eqName(plan.equipment?.kettleId)],
  ].filter(([, v]) => v);
  $('equip').replaceChildren(...equipRows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));

  let prev = 0;
  $('pourBody').replaceChildren(
    ...plan.pours.map((p, i) => {
      const amount = p.toG - prev;
      prev = p.toG;
      return el(
        'tr',
        {},
        el('td', {}, pourName(i).replace('投目', '')),
        el('td', { class: 'num' }, formatSec(p.atSec)),
        el('td', { class: 'num' }, formatG(p.toG)),
        el(
          'td',
          {},
          el('span', { class: 'num' }, `+${formatG(amount)}`),
          p.style ? el('span', { class: 'muted' }, ` ${POUR_STYLES[p.style] ?? ''}`) : '',
          el('div', { class: 'muted small num' }, `${pourEndSec(plan, i) - p.atSec}秒で注ぐ`),
        ),
      );
    }),
  );
  $('target').textContent = [
    plan.bloom?.stir ? '蒸らしで攪拌する' : '',
    plan.targetTotalSec ? `落ち切りの目標 ${formatSec(plan.targetTotalSec)}` : '',
  ]
    .filter(Boolean)
    .join('　');
}

/** 新しく始める。途中の抽出があれば、捨ててよいか確かめる */
function beginNew(withTimer) {
  if (!loadedPlan) return;
  if (loadDraft() && !confirm('途中の抽出を捨てて、新しく始めますか？')) return;
  draft = { ...newDraft(loadedPlan.plan, $('bean').value || null, withTimer ? Date.now() : null), returnSearch: location.search };
  saveDraft(draft);
  $('content').hidden = true;
  if (withTimer) {
    cue.unlock(); // 押した瞬間に音と読み上げを使える状態にする（iPhone）
    startTimer();
  } else showResult();
}

// ---- ガイド付きタイマー（A2）と画面スリープ防止（A3） ----

let tickId = null;
let prevSec = null;
const wake = createWakeLock(renderWake);
let wakeState = null;

function renderWake(state) {
  wakeState = state;
  const text = {
    on: '',
    off: '',
    unsupported: 'この端末では画面を消さない設定が使えません。iPhoneの「設定」→「画面表示と明るさ」→「自動ロック」を長くしてください',
    failed: '画面を消さない設定を使えませんでした。画面のどこかを押すともう一度試します',
  }[state];
  $('tWake').textContent = text ?? '';
}

function renderSpeechToggle() {
  const btn = $('speechToggle');
  btn.hidden = !cue.canSpeak;
  btn.textContent = `読み上げ ${speechOn ? 'オン' : 'オフ'}`;
  btn.setAttribute('aria-pressed', String(speechOn));
}

function startTimer() {
  $('timerView').hidden = false;
  document.body.classList.add('timer-on');
  renderSpeechToggle();
  wake.start();
  prevSec = null;
  tick();
  clearInterval(tickId);
  tickId = setInterval(tick, 100);
}

function stopTimer() {
  clearInterval(tickId);
  tickId = null;
  wake.stop();
  cue.stopSpeaking();
  $('timerView').hidden = true;
  document.body.classList.remove('timer-on');
}

function tick() {
  const plan = draft.plan;
  const sec = elapsedSec(draft, Date.now());
  // 合図：前回の更新から今までに来た合図を鳴らす（スタート直後は0秒の合図から）
  const from = prevSec ?? (sec < 1 ? -0.001 : sec);
  for (const c of cuesBetween(plan, from, sec, draft.laps)) cue.playCue(c, { speech: speechOn });
  prevSec = sec;

  const laps = autoAdvance(plan.pours, draft.laps, sec);
  if (laps.length !== draft.laps.length) {
    draft = { ...draft, laps };
    saveDraft(draft);
  }
  renderTimer(timerView(plan, draft.laps, sec), sec);
}

function renderTimer(v, sec) {
  $('tElapsed').textContent = formatSec(Math.floor(sec));
  const count = $('tCount');
  count.classList.remove('soon');
  const screen = $('timerView');
  screen.dataset.phase = v.phase;
  const tap = $('tap');
  tap.classList.toggle('drawdown', v.phase === 'drawdown');
  tap.classList.toggle('idle', v.phase === 'wait' && !v.canTap);
  const plan = draft.plan;
  const styleOf = (x) => (x.style ? `（${POUR_STYLES[x.style] ?? ''}）` : '');
  const toTarget = (s) => (s == null ? '' : s >= 0 ? `目標まで あと${s}秒` : `目標を${-s}秒 超過`);

  if (v.phase === 'drawdown') {
    $('tPhase').textContent = '落ち切り待ち';
    $('tLabel').textContent = '';
    $('tTarget').textContent = `累計 ${formatG(plan.waterG)}`;
    $('tAdd').textContent = '';
    count.textContent = toTarget(v.secsToTarget);
    $('tNext').textContent = plan.targetTotalSec ? `目標 ${formatSec(plan.targetTotalSec)}` : '';
    $('tapLabel').textContent = '落ち切った';
    $('tapSub').textContent = '押すとタイマーを止めて記録に進みます';
    return;
  }

  if (v.phase === 'pour') {
    $('tPhase').textContent = '注ぐ';
    $('tLabel').textContent = v.name;
    $('tTarget').textContent = `累計 ${formatG(v.toG)}`;
    $('tAdd').textContent = `+${formatG(v.addG)}${styleOf(v)}`;
    count.textContent = `注ぎ終わりまで あと${v.secsLeft}秒`;
    if (v.secsLeft <= 3) count.classList.add('soon');
    $('tNext').textContent = v.flowGps != null ? `${v.pourSec}秒で注ぐ（流速 ${v.flowGps}g/秒）` : '';
    $('tapLabel').textContent = v.isLast ? '注ぎ終えた' : '注湯完了';
    $('tapSub').textContent = '注ぎ終えたら押します（画面の下半分のどこでもよい）';
    return;
  }

  // 待つ
  $('tPhase').textContent = '待つ';
  const n = v.next;
  if (n) {
    $('tLabel').textContent = `次：${n.name}`;
    $('tTarget').textContent = `累計 ${formatG(n.toG)}`;
    $('tAdd').textContent = `+${formatG(n.addG)}${styleOf(n)}　${n.pourSec}秒で注ぐ`;
    count.textContent = `次の注湯まで あと${v.secsLeft}秒`;
    if (v.secsLeft <= 3) count.classList.add('soon');
  } else {
    $('tLabel').textContent = '注ぎ終わりの目安です';
    $('tTarget').textContent = `累計 ${formatG(plan.waterG)}`;
    $('tAdd').textContent = '';
    count.textContent = toTarget(v.secsToTarget);
  }
  if (v.canTap) {
    $('tNext').textContent = `${v.name}を注ぎ終えたら押してください`;
    $('tapLabel').textContent = v.isLast ? '注ぎ終えた' : '注湯完了';
    $('tapSub').textContent = v.isLast ? '押すと落ち切り待ちになります' : '押さなくても、次の注湯の時刻に進みます';
  } else {
    $('tNext').textContent = '';
    $('tapLabel').textContent = '待っています';
    $('tapSub').textContent = '注湯の時刻になると合図が鳴ります';
  }
}

function onTap() {
  cue.unlock();
  if (wakeState !== 'on' && wakeState !== 'unsupported') wake.start();
  const now = Date.now();
  const sec = elapsedSec(draft, now);
  const v = timerView(draft.plan, draft.laps, sec);
  if (v.phase === 'drawdown') {
    draft = finishDraft(draft, now);
    saveDraft(draft);
    stopTimer();
    cue.speak(speechOn ? 'おつかれさまでした' : '');
    showResult();
    return;
  }
  draft = { ...draft, laps: addLap(draft.plan.pours, draft.laps, sec) };
  saveDraft(draft);
  tick();
}

function cancelBrew() {
  if (!confirm('この抽出をやめますか？記録は残りません')) return;
  stopTimer();
  const back = draft?.returnSearch ?? '';
  clearDraft();
  draft = null;
  if (back) location.replace(`brew.html${back}`);
  else location.replace('recipes.html');
}

// ---- 実績の確認（A4） ----

const fields = {};

function readForm() {
  return {
    beanId: $('rBean').value,
    doseG: fields.dose.input.value,
    waterG: fields.water.input.value,
    tempC: fields.temp.input.value,
    grindSetting: $('rGrind').value,
    totalSec: $('rTotal').value,
    beverageG: fields.bev.input.value,
    memo: $('rMemo').value,
  };
}

function onFormInput() {
  draft = { ...draft, input: readForm() };
  saveDraft(draft);
  renderDiff();
}

function renderDiff() {
  const { value } = normalizeActualInput(readForm());
  const actual = { ...value, grind: { setting: value.grindSetting } };
  const lines = diffLines(brewDiff(draft.plan, actual), draft.plan, actual);
  $('diff').replaceChildren(...(lines.length ? lines.map((t) => el('li', { class: 'num' }, t)) : [el('li', { class: 'muted' }, '計画どおりです')]));
}

function buildResultForm() {
  if (fields.dose) return;
  const make = (box, opts) => {
    const f = stepperField({ ...opts, onValue: onFormInput });
    $(box).replaceChildren(f.node);
    return f;
  };
  fields.dose = make('rDoseBox', { id: 'rDose', label: '粉量', unit: 'g', step: 0.1, decimals: 1, min: 0, errorFor: 'doseG' });
  fields.water = make('rWaterBox', { id: 'rWater', label: '湯量', unit: 'g', step: 1, decimals: 1, min: 0, errorFor: 'waterG' });
  fields.temp = make('rTempBox', { id: 'rTemp', label: '湯温', unit: '℃', step: 1, decimals: 1, min: 50, max: 100, errorFor: 'tempC' });
  fields.bev = make('rBevBox', {
    id: 'rBev',
    label: '抽出液の重さ',
    unit: 'g',
    step: 1,
    decimals: 0,
    min: 0,
    hint: '量ったときだけ入れます',
    errorFor: 'beverageG',
  });
  for (const id of ['rBean', 'rGrind', 'rTotal', 'rMemo']) $(id).addEventListener('input', onFormInput);
}

function showResult() {
  buildResultForm();
  const input = draft.input ?? initialActualInput(draft);
  fillBeanSelect($('rBean'), input.beanId);
  fields.dose.set(input.doseG);
  fields.water.set(input.waterG);
  fields.temp.set(input.tempC);
  fields.bev.set(input.beverageG);
  $('rGrind').value = input.grindSetting ?? '';
  $('rTotal').value = input.totalSec ?? '';
  $('rMemo').value = input.memo ?? '';

  const plan = draft.plan;
  $('resultSub').textContent = [plan.name, draft.startedAtMs == null ? 'タイマーなし' : ''].filter(Boolean).join('・');
  $('poursCard').hidden = draft.startedAtMs == null;
  $('rPourBody').replaceChildren(
    ...plan.pours.map((p, i) =>
      el(
        'tr',
        {},
        el('td', {}, pourName(i).replace('投目', '')),
        el('td', { class: 'num' }, formatSec(p.atSec)),
        el('td', { class: 'num' }, draft.laps[i] != null ? formatSec(Math.round(draft.laps[i])) : '—'),
        el('td', { class: 'num' }, formatG(p.toG)),
      ),
    ),
  );
  $('content').hidden = true;
  $('resultView').hidden = false;
  document.title = '実績の確認 - Pourfolio';
  renderDiff();
  window.scrollTo(0, 0);
}

function showErrors(errors) {
  for (const node of document.querySelectorAll('#resultView .field-error')) node.textContent = errors[node.dataset.for] ?? '';
}

async function onSave(e) {
  e.preventDefault();
  const { value, errors } = normalizeActualInput(readForm());
  showErrors(errors);
  if (Object.keys(errors).length) {
    showMessage('赤い文字のところを直してください', 'error', 'rMsg');
    document.querySelector('#resultView .field-error:not(:empty)')?.scrollIntoView({ block: 'center' });
    return;
  }
  const bean = beans.find((b) => b.id === value.beanId) ?? null;
  const at = new Date(draft.startedAtMs ?? Date.now()).toISOString();
  try {
    const { brew } = await saveBrew(db, buildBrew({ draft, value, at, bean }));
    clearDraft();
    draft = null;
    // そのまま味の評価へ（spec 8章：実績の確認 → テイスティング）。戻るで実績の確認に戻らないよう replace
    location.replace(`tasting.html?brew=${encodeURIComponent(brew.id)}&saved=1`);
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error', 'rMsg');
  }
}

function discard() {
  if (!confirm('記録せずにやめますか？入れた内容は消えます')) return;
  const back = draft?.returnSearch ?? '';
  clearDraft();
  draft = null;
  location.replace(back ? `brew.html${back}` : 'recipes.html');
}

// ---- はじまり ----

async function init() {
  const settings = await getSettings(db);
  speechOn = settings.speechOn !== false;
  beans = await listBeans(db);
  const saved = loadDraft();
  const sameAsSaved = saved && (location.search === '' || location.search === saved.returnSearch);

  if (saved && sameAsSaved) {
    // 途中の抽出の続き
    draft = saved;
    if (draft.stage === 'timer') startTimer();
    else showResult();
    return;
  }

  loadedPlan = await loadPlan();
  if (!loadedPlan) {
    $('notFound').hidden = false;
    return;
  }
  const last = await getLastBrew(db);
  await showPlan(loadedPlan, last?.beanId);
  if (saved) {
    $('resumeCard').hidden = false;
    $('resumeText').textContent = `${saved.plan.name || '前回と同じ'}（${saved.stage === 'timer' ? 'タイマーの途中' : '実績の確認の途中'}）`;
  }
}

$('start').addEventListener('click', () => beginNew(true));
$('noTimer').addEventListener('click', () => beginNew(false));
$('resume').addEventListener('click', () => {
  const saved = loadDraft();
  location.href = saved?.returnSearch ? `brew.html${saved.returnSearch}` : 'brew.html';
});
$('tap').addEventListener('click', onTap);
$('cancel').addEventListener('click', cancelBrew);
$('speechToggle').addEventListener('click', async () => {
  speechOn = !speechOn;
  renderSpeechToggle();
  if (!speechOn) cue.stopSpeaking();
  await updateSettings(db, { speechOn });
});
$('resultView').addEventListener('submit', onSave);
$('discard').addEventListener('click', discard);
$('crumb').addEventListener('click', (e) => {
  if (draft && !confirm('記録せずに戻りますか？途中の内容は消えます')) {
    e.preventDefault();
    return;
  }
  if (draft) clearDraft();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') cue.resume();
});
window.addEventListener('beforeunload', (e) => {
  if (draft?.stage === 'timer') e.preventDefault();
});

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込みに失敗しました', 'error');
});
