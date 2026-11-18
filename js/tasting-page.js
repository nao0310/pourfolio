// 味の評価の画面：クイック評価（B1）、ちょうど良さ評価（JAR、B2）、詳細評価（B3）、香味と雑味（B4）
// tasting.html?brew=<抽出のID>（抽出を保存した直後は &saved=1 が付き、豆の残量を上に出す）
import { openDb, getBrew, getTastingForBrew, saveTasting, getBeanWithTx, getSettings, saveSuggestionForBrew } from './db.js';
import { CONFIDENCE_LABELS, CHANGING_KINDS } from './core/dialin.js';
import { renderStars, renderTags, renderJar, renderDetail, renderFlavors, renderDefects } from './tasting-parts.js';
import {
  detailAnsweredCount,
  allJustJar,
  tastingInput,
  normalizeTastingInput,
  tastingSummary,
  brewLine,
} from './core/tastings.js';
import { formatSec } from './core/recipes.js';
import { remainingG, cupsLeft, doseFromSettings } from './core/inventory.js';
import { formatG } from './core/format.js';
import { portionsOf, stockParts, stockPartsText } from './core/frozen.js';
import { $, el, queryParam, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
let brew = null;
let bean = null;
/** 入力中の評価 { stars, tags, jar, memo } */
let state = null;

// ---- 入力の部品（js/tasting-parts.js） ----

function renderForm() {
  renderStars($('stars'), state, clearErrors);
  renderTags($('tags'), state, clearErrors);
  renderJar($('jar'), state, clearErrors);
  renderFlavors($('flavors'), state, clearErrors);
  renderDefects($('defects'), state, clearErrors);
  renderDetail($('detail'), state, clearErrors, $('detailCount'));
  $('detailBox').open = detailAnsweredCount(state) > 0; // 入れてあれば開いておく
  $('memo').value = state.memo;
}

function showErrors(errors) {
  for (const node of document.querySelectorAll('#formView .field-error')) node.textContent = errors[node.dataset.for] ?? '';
}
const clearErrors = () => {
  showErrors({});
  showMessage('', 'ok');
};

// ---- 保存 ----

async function onSave(e) {
  e.preventDefault();
  state.memo = $('memo').value;
  const { value, errors } = normalizeTastingInput(state);
  showErrors(errors);
  if (Object.keys(errors).length) {
    showMessage(errors.empty ?? '赤い文字のところを直してください', 'error');
    return;
  }
  $('save').disabled = true;
  try {
    const saved = await saveTasting(db, brew.id, value);
    let suggestion = null;
    try {
      suggestion = await saveSuggestionForBrew(db, brew.id);
    } catch (err) {
      console.error(err); // 提案が作れなくても評価は保存できている
    }
    showDone(saved, suggestion);
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error');
  } finally {
    $('save').disabled = false;
  }
}

/** 提案の「淹れる」ボタンの文字 */
function brewButtonLabel(action) {
  if (action.kind === 'keep') return '同じ計画で淹れる';
  if (action.kind === 'repeat') return '同じ条件でもう1杯淹れる';
  if (CHANGING_KINDS.includes(action.kind) && action.to == null) return '前回と同じ計画で淹れる';
  return 'この提案で淹れる';
}

function renderSuggestion(s) {
  $('suggestCard').hidden = !s;
  $('noSuggest').hidden = Boolean(s);
  $('doneTop').classList.toggle('secondary', Boolean(s)); // 目立つボタンは「この提案で淹れる」の1つだけにする
  if (!s) return;
  $('sCell').textContent = s.cellName;
  $('sAction').textContent = s.action.text;
  $('sNext').textContent = [s.nextStep, s.alt].filter(Boolean).join('。');
  $('sNext').hidden = !$('sNext').textContent;
  $('sBrew').textContent = brewButtonLabel(s.action);
  $('sBrew').href = `brew.html?suggestion=${encodeURIComponent(s.id)}`;
  const r = s.reasons ?? {};
  const items = [
    ['あなたの入力', (r.input ?? []).join('・')],
    ['理論', r.theory],
    ['あなたの実績', r.history],
    ['確信度', r.confidence ? `${CONFIDENCE_LABELS[r.confidence.level] ?? ''}（${r.confidence.text}）` : ''],
  ].filter(([, v]) => v);
  $('sReasons').replaceChildren(...items.map(([k, v]) => el('li', {}, el('strong', {}, k), el('span', {}, v))));
}

function showDone(saved, suggestion) {
  renderSuggestion(suggestion);
  $('formView').hidden = true;
  $('doneView').hidden = false;
  document.title = '評価を保存しました - Pourfolio';
  $('doneBrew').textContent = [bean?.name, brewLine(brew)].filter(Boolean).join('　');
  $('doneSummary').textContent = tastingSummary(saved) || 'メモだけ';
  $('save').textContent = '評価を直して保存する';
  $('savedCard').hidden = true;
  if (bean) {
    $('doneBean').href = `bean.html?id=${encodeURIComponent(bean.id)}`;
    $('doneBean').hidden = false;
  }
  window.scrollTo(0, 0);
}

function showForm() {
  $('doneView').hidden = true;
  $('formView').hidden = false;
  document.title = '味の評価 - Pourfolio';
  window.scrollTo(0, 0);
}

// ---- はじまり ----

async function showSavedStock() {
  if (!bean) {
    $('savedStock').textContent = '豆を選ばずに記録しました';
  } else {
    const loaded = await getBeanWithTx(db, bean.id);
    // 残りは常温＋冷凍の合計（C4）。冷凍の袋があれば内訳も出す
    const parts = stockParts(remainingG(loaded?.txs ?? []), portionsOf(loaded?.portions ?? [], bean.id));
    const dose = doseFromSettings(await getSettings(db));
    const detail = parts.frozenCount ? `・${stockPartsText(parts)}` : '';
    $('savedStock').textContent = `${bean.name}の残り ${formatG(parts.totalG)}（あと${cupsLeft(parts.totalG, dose)}杯${detail}）`;
  }
  $('savedCard').hidden = false;
}

async function init() {
  const id = queryParam('brew');
  brew = id ? await getBrew(db, id) : null;
  if (!brew) {
    $('notFound').hidden = false;
    return;
  }
  bean = brew.beanId ? (await getBeanWithTx(db, brew.beanId))?.bean ?? null : null;
  const existing = await getTastingForBrew(db, brew.id);
  state = tastingInput(existing);

  const a = brew.actual ?? {};
  $('sub').textContent = [bean?.name ?? '豆なし', brewLine(brew), a.totalSec != null ? formatSec(a.totalSec) : ''].filter(Boolean).join('　');
  if (queryParam('saved') === '1' && !existing) await showSavedStock();
  if (existing) $('save').textContent = '評価を直して保存する';
  renderForm();
  $('formView').hidden = false;
}

$('formView').addEventListener('submit', onSave);
$('memo').addEventListener('input', clearErrors);
$('allJust').addEventListener('click', () => {
  state.jar = allJustJar();
  renderJar($('jar'), state, clearErrors);
  clearErrors();
});
$('edit').addEventListener('click', showForm);

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込みに失敗しました', 'error');
});
