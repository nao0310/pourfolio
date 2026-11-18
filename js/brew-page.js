// 抽出の画面：計画（A1）→ ガイド付きタイマー（A2・A3）→ 実績の確認（A4）→ 保存 → 味の評価（tasting.html）
// 途中の状態は下書き（js/brew-draft.js）に残し、画面を開き直しても続きから進める。
import {
  openDb,
  getRecipe,
  getLastBrew,
  getBrew,
  listBeans,
  listEquipment,
  getSettings,
  updateSettings,
  saveBrew,
  getSuggestion,
  listSuggestions,
  listFrozenPortions,
  listAliveTx,
  getExperiment,
  attachBrewToExperiment,
  listBrews,
  listTastings,
  listRecipes,
} from './db.js';
import { adjustPlan, adjustNotes, parseAdjustParams, adjustQuery, hotPlanOf, carryIce, isIced, MOODS, CUP_OPTIONS, cupsLabel } from './core/plan-adjust.js';
import { initialRecipe, initialPlan, baseRecipe } from './core/initial-recipe.js';
import { defaultEquipmentIds } from './core/equipment.js';
import { doseFromSettings } from './core/inventory.js';
import { frozenChoice, portionsOf, portionText } from './core/frozen.js';
import { remainingG } from './core/inventory.js';
import { basePlanForNext, applyAction, pickPendingSuggestion } from './core/dialin.js';
import { planFromRecipe, planFromBrew, formatSec, POUR_STYLES, ratioOf } from './core/recipes.js';
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
  PRECHECK_ITEMS,
} from './core/brews.js';
import { loadDraft, saveDraft, clearDraft } from './brew-draft.js';
import { pickGhost, ghostLine } from './core/ghost.js';
import * as cue from './cue.js';
import { createWakeLock } from './wake-lock.js';
import { $, el, queryParam, showMessage, stepperField } from './ui.js';
import { registerServiceWorker, blockUpdatePrompt, recheckUpdatePrompt } from './pwa.js';

const db = openDb();
let draft = null;
let beans = [];
let speechOn = true;
let loadedPlan = null;
let suggestions = [];
let portions = [];
let txs = [];
/** 登録した器具と水（水は D3。実績の確認で選ぶ） */
let equipmentList = [];
const waters = () => equipmentList.filter((e) => e.kind === 'water');
/** 抽出前チェック（A5）で押した項目 */
let precheck = {};
/** 焙煎度比較（X27）で淹れるときの飲み比べ（?compare=ID） */
let compare = null;

// ---- 計画（スタート前） ----

/** アイスで淹れた杯を土台にするときは、元の湯量に戻し、アイスを初めから選んでおく */
function fromBrewPlan(plan, src) {
  return isIced(src) ? { plan: hotPlanOf(plan, src.context.iceG), icedDefault: true } : { plan, icedDefault: false };
}

/**
 * URL（?recipe=ID、?from=last、?suggestion=ID、?brew=ID、?initial=豆ID）から土台の計画を作る。見つからなければ null。
 * 気分・杯数・アイス・数値の上書き（?mood= ?cups= ?iced= ?dose= など）は、あとで土台に当てはめる（applyAdjust）
 */
async function loadPlan() {
  const suggestionId = queryParam('suggestion');
  if (suggestionId) {
    // ダイヤルイン提案（F1）：提案を出した抽出の計画に、提案の1つだけを入れる（レシピは変えない）
    const suggestion = await getSuggestion(db, suggestionId);
    const src = suggestion ? await getBrew(db, suggestion.brewId) : null;
    if (!src) return null;
    const recipe = src.recipeId ? await getRecipe(db, src.recipeId) : null;
    // 提案はお湯の量で計算してあるので、アイスの杯なら氷の量だけ引き継ぐ（気分・杯数は選べない）
    const plan = carryIce({ ...applyAction(basePlanForNext(src, recipe), suggestion.action), source: 'suggestion', suggestionId: suggestion.id }, src.context?.iceG);
    return { plan, base: plan, recipe, suggestion, fixed: true };
  }
  const recipeId = queryParam('recipe');
  if (recipeId) {
    const recipe = await getRecipe(db, recipeId);
    return recipe ? { base: planFromRecipe(recipe), recipe } : null;
  }
  const brewId = queryParam('brew');
  if (brewId) {
    // 今日の一杯（F3）：その豆で★がいちばん高かった杯の淹れ方（挽き目は実際に挽いた目盛り）
    const src = await getBrew(db, brewId);
    if (!src) return null;
    const recipe = src.recipeId ? await getRecipe(db, src.recipeId) : null;
    const { plan, icedDefault } = fromBrewPlan({ ...basePlanForNext(src, recipe), source: 'bestBrew' }, src);
    return { base: plan, recipe, icedDefault };
  }
  const initialBeanId = queryParam('initial');
  if (initialBeanId) {
    // 新しい豆の初期レシピ（F2）
    const bean = beans.find((b) => b.id === initialBeanId);
    if (!bean) return null;
    const [brews, tastings, recipes, settings] = await Promise.all([listBrews(db), listTastings(db), listRecipes(db), getSettings(db)]);
    const recipe = baseRecipe(recipes, brews);
    const grinderId = recipe?.grind?.grinderId ?? defaultEquipmentIds(equipmentList).grinderId;
    const init = initialRecipe({ bean, beans, brews, tastings, grinders: equipmentList.filter((e) => e.kind === 'grinder'), grinderId, defaultDoseG: doseFromSettings(settings) });
    return { base: initialPlan(init, recipe, bean), recipe, init };
  }
  if (queryParam('from') === 'last') {
    const last = await getLastBrew(db);
    if (!last) return null;
    const recipe = last.recipeId ? await getRecipe(db, last.recipeId) : null;
    const { plan, icedDefault } = fromBrewPlan(planFromBrew(last, recipe), last);
    return { base: plan, recipe, icedDefault };
  }
  return null;
}

/** 量・アイス・気分の今の選択（URL から読み、画面で変える） */
let adj = { mood: null, cups: 1, iced: false, overrides: {} };

/** 土台の計画に今の選択を当てはめる */
function applyAdjust() {
  if (loadedPlan.fixed) return;
  loadedPlan.plan = adjustPlan(loadedPlan.base, adj);
}

/** 量・アイス・気分の欄（提案を入れた計画・飲み比べでは出さない） */
function renderAdjust() {
  const show = !loadedPlan.fixed && !compare;
  $('adjustCard').hidden = !show;
  if (!show) return;
  const seg = (label, pressed, onClick) => el('button', { type: 'button', class: 'seg', 'aria-pressed': String(pressed), onclick: onClick }, label);
  $('cupsSeg').replaceChildren(...CUP_OPTIONS.map((c) => seg(cupsLabel(c), adj.cups === c, () => setAdjust({ cups: c }))));
  $('moodSeg').replaceChildren(
    seg('なし', !adj.mood, () => setAdjust({ mood: null })),
    ...Object.entries(MOODS).map(([k, m]) => seg(m.label, adj.mood === k, () => setAdjust({ mood: k, ...(k === 'guest' && adj.cups === 1 ? { cups: MOODS.guest.cups } : {}) }))),
  );
  $('iced').checked = adj.iced;
  const m = MOODS[adj.mood];
  $('moodAim').textContent = m ? `狙い：${m.aim}` : '';
}

/** 選択を変えたら計画を作り直し、URL にも残す（開き直しても同じ計画になるように） */
function setAdjust(change) {
  adj = { ...adj, ...change };
  applyAdjust();
  const q = new URLSearchParams(location.search);
  for (const k of ['mood', 'cups', 'iced']) q.delete(k);
  const extra = new URLSearchParams(adjustQuery({ mood: adj.mood, cups: adj.cups, iced: adj.iced }, loadedPlan.icedDefault));
  for (const [k, v] of extra) q.set(k, v);
  const search = q.toString() ? `?${q.toString()}` : '';
  history.replaceState(null, '', `${location.pathname}${search}`);
  renderAdjust();
  renderPlanBody();
}

function planItem(label, value, changed = false) {
  return el(
    'div',
    { class: `plan-item${changed ? ' changed' : ''}` },
    el('span', { class: 'muted' }, label),
    el('span', { class: 'num plan-value' }, value || '—'),
    changed ? el('span', { class: 'changed-tag' }, '提案で変更') : '',
  );
}

/** 提案のカード。提案を入れた計画ならその説明、そうでなければ選んだ豆のまだ使っていない提案 */
function renderSuggestCard() {
  const fromSuggestion = loadedPlan?.suggestion;
  const s = fromSuggestion ?? pickPendingSuggestion(suggestions, $('bean').value || null);
  $('suggestCard').hidden = !s;
  if (!s) return;
  $('sText').textContent = s.action?.text ?? '';
  if (fromSuggestion) {
    $('sTitle').textContent = '提案を入れた計画です';
    $('sNote').textContent = 'レシピは変わりません。この1杯の計画だけを変えています';
    $('sRow').hidden = true;
  } else {
    $('sTitle').textContent = 'この豆の前回の提案';
    $('sNote').textContent = `${s.cellName ?? ''}（前回の評価から）`;
    $('sUse').href = `brew.html?suggestion=${encodeURIComponent(s.id)}`;
    $('sRow').hidden = false;
  }
}

/** 豆の選択肢（飲み切り以外） */
function fillBeanSelect(select, selectedId) {
  // 飲み切りと入荷待ち（まだ手元にない）の豆は選べない（選んであった豆は残す）
  const usable = sortBeansForList(beans).filter((b) => (b.status !== 'finished' && b.status !== 'ordered') || b.id === selectedId);
  select.replaceChildren(
    el('option', { value: '' }, usable.length ? '（選ばない）' : '（豆が未登録）'),
    ...usable.map((b) => el('option', { value: b.id }, [b.name, b.roastLevel].filter(Boolean).join('　'))),
  );
  select.value = usable.some((b) => b.id === selectedId) ? selectedId : '';
  return usable;
}

/** 計画の画面の豆の下の一言（前回の豆か、冷凍の袋があるか） */
function renderBeanNote(preferred = null) {
  const id = $('bean').value;
  const notes = [];
  if (preferred && id === preferred) notes.push(compare ? '飲み比べの袋を選んでいます' : queryParam('bean') === id ? '選んだ豆です' : '前回の豆を選んでいます');
  const n = id ? portionsOf(portions, id).length : 0;
  if (n) notes.push(`冷凍${n}袋あり（記録するときに「冷凍の袋を使う」を選べます）`);
  $('beanNote').textContent = notes.join('。');
}

/** 常温の残り（g） */
const roomOf = (beanId) => remainingG(txs.filter((t) => t.beanId === beanId));

/** 実績の確認：選んだ豆に冷凍の袋があれば「冷凍の袋を使う」を出す */
function renderFrozenChoice(keepChecked) {
  const beanId = $('rBean').value;
  const { portion, checked } = frozenChoice({ portions, beanId, roomG: roomOf(beanId), doseG: Number(fields.dose?.input.value) || draft?.plan?.doseG });
  $('rFrozenRow').hidden = !portion;
  if (!portion) {
    $('rFrozen').checked = false;
    return;
  }
  $('rFrozenText').textContent = `冷凍の袋を使う：${portionText(portion)}`;
  $('rFrozen').checked = keepChecked ?? checked;
}

async function showPlan(loaded, lastBeanId) {
  const { plan, recipe } = loaded;

  $('content').hidden = false;
  const names = {
    lastBrew: [`前回と同じ：${recipe?.name ?? plan.name}`, '前回の抽出の計画を写しました'],
    suggestion: [`提案を入れた計画：${recipe?.name ?? plan.name}`, '評価した抽出の計画に、提案の1つだけを入れました'],
    bestBrew: [`★がいちばん高かった杯：${recipe?.name ?? plan.name}`, 'この豆でいちばん★が高かった杯の計画を写しました（挽き目は実際に挽いた目盛り）'],
    initial: [plan.name, recipe ? `いつものレシピ「${recipe.name}」の注ぎ方に、この豆向けの数字を入れました` : '4:6メソッドの注ぎ方に、この豆向けの数字を入れました'],
  }[plan.source] ?? [plan.name, `レシピ 版${plan.recipeVersion}`];
  $('name').textContent = names[0];
  document.title = `${$('name').textContent} - Pourfolio`;
  $('sub').textContent = names[1];
  // AI相談（F5）の答えから来たとき
  if (queryParam('via') === 'ai') {
    $('name').textContent = `AIの提案：${recipe?.name ?? plan.name}`;
    $('sub').textContent = 'AIの答えから読み取った数字（粉量・湯量・湯温・挽き目）を、この注ぎ方に入れました';
  }
  if (plan.recipeId && recipe) $('editLink').href = `recipe-edit.html?id=${encodeURIComponent(plan.recipeId)}`;
  else $('editLink').hidden = true;
  // 初期レシピ（F2）は、どこから決めたかを出す
  $('initCard').hidden = !loaded.init;
  if (loaded.init) $('initReasons').replaceChildren(...loaded.init.reasons.map((t) => el('li', {}, t)));

  // 豆：初期値は ?bean= の豆（焙煎度比較）、前回の豆、一覧の先頭の順
  const preferred = queryParam('bean') ?? plan.beanId ?? lastBeanId ?? null;
  const usable = fillBeanSelect($('bean'), preferred);
  if (!$('bean').value && usable[0]) $('bean').value = usable[0].id;
  renderBeanNote(preferred);
  renderSuggestCard();
  renderAdjust();
  renderPlanBody();
}

/** 計画の数字・器具・注湯の予定（量・アイス・気分を変えたら描き直す） */
function renderPlanBody() {
  const loaded = loadedPlan;
  const { plan } = loaded;
  const eqName = (id) => equipmentList.find((e) => e.id === id)?.name ?? '';
  const changed = plan.source === 'suggestion' && loaded.suggestion?.action?.to != null ? loaded.suggestion.action.variable : null;
  $('plan').replaceChildren(
    planItem('粉量', formatG(plan.doseG), changed === 'doseG'),
    planItem(plan.adjust?.iceG ? 'お湯' : '湯量', formatG(plan.waterG), changed === 'waterG'),
    plan.adjust?.iceG ? planItem('氷', formatG(plan.adjust.iceG)) : '',
    plan.adjust?.iceG
      ? planItem('比率（氷込み）', `1:${ratioOf(plan.doseG, plan.waterG + plan.adjust.iceG)}`)
      : planItem('比率', plan.ratio ? `1:${plan.ratio}` : '', changed === 'doseG' || changed === 'waterG'),
    planItem('湯温', plan.tempC != null ? `${plan.tempC}℃` : ''),
    planItem('挽き目', plan.grind?.setting ?? '', changed === 'grind'),
    planItem('目標時間', formatSec(plan.targetTotalSec)),
  );
  const equipRows = [
    ['グラインダー', eqName(plan.grind?.grinderId)],
    ['ドリッパー', eqName(plan.equipment?.dripperId)],
    ['フィルター', eqName(plan.equipment?.filterId)],
    ['ケトル', eqName(plan.equipment?.kettleId)],
  ].filter(([, v]) => v);
  $('equip').replaceChildren(...equipRows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  const notes = adjustNotes(plan);
  $('adjustNotes').hidden = !notes.length;
  $('adjustNotes').replaceChildren(...notes.map((t) => el('li', {}, t)));

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
  renderPrecheck(plan);
  $('target').textContent = [
    plan.bloom?.stir ? '蒸らしで攪拌する' : '',
    plan.targetTotalSec ? `落ち切りの目標 ${formatSec(plan.targetTotalSec)}` : '',
  ]
    .filter(Boolean)
    .join('　');
}

/** 抽出前チェック（A5）の4つのボタン。湯温には計画の温度を添える */
function renderPrecheck(plan) {
  $('precheck').replaceChildren(
    ...PRECHECK_ITEMS.map((item) => {
      const label = item.key === 'temp' && plan.tempC != null ? `${item.label} ${plan.tempC}℃` : item.label;
      return el(
        'label',
        { class: 'check-row precheck-item' },
        el('input', {
          type: 'checkbox',
          checked: precheck[item.key] === true,
          onchange: (e) => {
            precheck = { ...precheck, [item.key]: e.target.checked };
          },
        }),
        el('span', {}, el('strong', {}, label), el('span', { class: 'muted small precheck-hint' }, item.hint)),
      );
    }),
  );
}

/** ゴーストを選ぶための抽出と評価（計画の画面を開いたときに読んでおく。スタートを押した瞬間に音を使えるよう、押したあとは待たない） */
let ghostSource = { brews: [], tastings: [] };

/** 同じレシピで★がいちばん高かった杯（なければ null） */
function findGhost(recipeId, beanId) {
  return pickGhost({ ...ghostSource, recipeId, beanId });
}

/** 新しく始める。途中の抽出があれば、捨ててよいか確かめる */
function beginNew(withTimer) {
  if (!loadedPlan) return;
  if (loadDraft() && !confirm('途中の抽出を捨てて、新しく始めますか？')) return;
  draft = {
    ...newDraft(loadedPlan.plan, $('bean').value || null, withTimer ? Date.now() : null, precheck),
    returnSearch: location.search,
    // 焙煎度比較（X27）で淹れるとき：保存したら飲み比べにつなぎ、飲み比べの画面に戻る
    compareId: compare?.id ?? null,
    compareBeanId: compare ? queryParam('bean') : null,
  };
  // 前回のベストのペース（ゴースト、D-041）。下書きに入れておき、開き直しても同じ杯と比べる
  // 量やアイスを変えた計画は、ペースが違うので比べない
  const scaled = loadedPlan.plan.adjust && (loadedPlan.plan.adjust.cups !== 1 || loadedPlan.plan.adjust.iceG != null);
  if (withTimer && !scaled) draft.ghost = findGhost(loadedPlan.plan.recipeId, draft.beanId);
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
  recheckUpdatePrompt(); // 計画の画面で出ていた「新しい版があります」を隠す
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
  $('tGhost').textContent = ghostLine(draft.ghost ?? null, draft.laps, v, pourName);
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
    tdsPct: fields.tds.input.value,
    waterId: $('rWaterRow').hidden ? '' : $('rWaterId').value,
    memo: $('rMemo').value,
    useFrozen: !$('rFrozenRow').hidden && $('rFrozen').checked,
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
  fields.tds = make('rTdsBox', {
    id: 'rTds',
    label: 'TDS（屈折計）',
    unit: '%',
    step: 0.01,
    decimals: 2,
    min: 0,
    hint: '屈折計で測ったときだけ入れます。あとから評価の画面でも入れられます',
    errorFor: 'tdsPct',
  });
  for (const id of ['rBean', 'rGrind', 'rTotal', 'rMemo']) $(id).addEventListener('input', onFormInput);
  $('rWaterId').addEventListener('change', onFormInput);
  $('rBean').addEventListener('change', () => {
    renderFrozenChoice();
    onFormInput();
  });
  $('rFrozen').addEventListener('change', onFormInput);
}

function showResult() {
  recheckUpdatePrompt();
  buildResultForm();
  const input = draft.input ?? initialActualInput(draft);
  fillBeanSelect($('rBean'), input.beanId);
  fields.dose.set(input.doseG);
  fields.water.set(input.waterG);
  fields.temp.set(input.tempC);
  fields.bev.set(input.beverageG);
  fields.tds.set(input.tdsPct ?? '');
  fillWaterSelect(input.waterId);
  $('rGrind').value = input.grindSetting ?? '';
  $('rTotal').value = input.totalSec ?? '';
  $('rMemo').value = input.memo ?? '';
  renderFrozenChoice(input.useFrozen);

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

/** 水（D3）を登録しているときだけ選べるようにする。初めは「いつも使う」水 */
function fillWaterSelect(selected) {
  const list = waters();
  $('rWaterRow').hidden = list.length === 0;
  if (!list.length) return;
  const def = list.find((w) => w.isDefault) ?? list[0];
  const cur = selected == null ? def.id : selected;
  $('rWaterId').replaceChildren(
    el('option', { value: '' }, '記録しない'),
    ...list.map((w) => el('option', { value: w.id, selected: w.id === cur }, w.name)),
  );
  $('rWaterId').value = list.some((w) => w.id === cur) ? cur : '';
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
  // 冷凍の袋を使う：保存すると袋を取り出したことになる（C4）
  const portion = readForm().useFrozen ? frozenChoice({ portions, beanId: value.beanId, roomG: 0, doseG: 0 }).portion : null;
  try {
    const { brew } = await saveBrew(db, buildBrew({ draft, value, at, bean, portion }));
    const { compareId, compareBeanId } = draft;
    clearDraft();
    draft = null;
    if (compareId) {
      // 焙煎度比較（X27）：評価はあとで飲み比べの画面でまとめて入れる（ブラインドを崩さないため）
      await attachBrewToExperiment(db, compareId, { brewId: brew.id, beanId: brew.beanId, targetBeanId: compareBeanId });
      location.replace(`compare.html?id=${encodeURIComponent(compareId)}&brewed=1`);
      return;
    }
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
  [portions, txs, equipmentList] = await Promise.all([listFrozenPortions(db), listAliveTx(db), listEquipment(db)]);
  const saved = loadDraft();
  const sameAsSaved = saved && (location.search === '' || location.search === saved.returnSearch);

  if (saved && sameAsSaved) {
    // 途中の抽出の続き
    draft = saved;
    if (draft.stage === 'timer') startTimer();
    else showResult();
    return;
  }

  suggestions = await listSuggestions(db);
  compare = queryParam('compare') ? await getExperiment(db, queryParam('compare')) : null;
  if (compare) {
    $('crumb').textContent = '飲み比べ';
    $('crumb').href = `compare.html?id=${encodeURIComponent(compare.id)}`;
    $('compareNote').hidden = false;
  }
  loadedPlan = await loadPlan();
  if (loadedPlan) {
    const p = parseAdjustParams(queryParam);
    adj = { mood: p.mood, cups: p.cups, iced: p.iced ?? Boolean(loadedPlan.icedDefault), overrides: p.overrides };
    applyAdjust();
  }
  if (!loadedPlan) {
    if (queryParam('initial') || queryParam('brew')) {
      $('notFound').querySelector('h1').textContent = '豆か記録が見つかりません';
      $('notFound').querySelector('p').textContent = '豆か抽出の記録が削除されています。トップに戻って選び直してください。';
    } else if (queryParam('suggestion')) {
      $('notFound').querySelector('h1').textContent = '提案が見つかりません';
      $('notFound').querySelector('p').textContent = '提案を出した抽出が削除されています。「淹れる」の一覧から選び直してください。';
    }
    $('notFound').hidden = false;
    return;
  }
  const last = await getLastBrew(db);
  await showPlan(loadedPlan, last?.beanId);
  try {
    const [brews, tastings] = await Promise.all([listBrews(db), listTastings(db)]);
    ghostSource = { brews, tastings };
  } catch (err) {
    console.error(err); // ゴーストが出ないだけで、淹れるのには困らない
  }
  if (saved) {
    $('resumeCard').hidden = false;
    $('resumeText').textContent = `${saved.plan.name || '前回と同じ'}（${saved.stage === 'timer' ? 'タイマーの途中' : '実績の確認の途中'}）`;
  }
}

$('start').addEventListener('click', () => beginNew(true));
$('bean').addEventListener('change', () => {
  renderSuggestCard();
  renderBeanNote();
});
$('noTimer').addEventListener('click', () => beginNew(false));
$('iced').addEventListener('change', (e) => setAdjust({ iced: e.target.checked }));
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

// タイマーと実績の確認の途中は、新しい版の知らせを出さない（押して読み込み直すと入力が途切れるため）
blockUpdatePrompt(() => draft != null || loadDraft() != null);
registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込みに失敗しました', 'error');
});
