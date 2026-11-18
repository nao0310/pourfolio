// 味の評価の画面：クイック評価（B1）、ちょうど良さ評価（JAR、B2）、詳細評価（B3）、香味と雑味（B4）
// 冷め際の評価（B5）：温度帯（熱いうち・温かいうち・冷めてから）ごとに1件。&stage=cool で冷めてからの評価を開く
// tasting.html?brew=<抽出のID>（抽出を保存した直後は &saved=1 が付き、豆の残量を上に出す）
import { normalizeTds, retentionTable, brewMetrics } from './core/extraction.js';
import {
  openDb,
  getBrew,
  listBrews,
  setBrewTds,
  getTastingsByStage,
  saveTasting,
  getBeanWithTx,
  getSettings,
  saveSuggestionForBrew,
  getPhotosForBrew,
  savePhoto,
  deletePhoto,
  getRecipe,
  listEquipment,
} from './db.js';
import { brewImageContent, imageFileName } from './core/report-image.js';
import { drawBrewImage, canvasToFile } from './brew-image.js';
import { autosaveAfterChange } from './autosave-file.js';
import { PHOTO_SLOTS } from './core/photos.js';
import { shrinkImageFile } from './photo.js';
import { CONFIDENCE_LABELS, CHANGING_KINDS } from './core/dialin.js';
import { renderStars, renderTags, renderJar, renderDetail, renderFlavors, renderDefects } from './tasting-parts.js';
import {
  detailAnsweredCount,
  allJustJar,
  tastingInput,
  normalizeTastingInput,
  tastingSummary,
  brewLine,
  STAGES,
  DEFAULT_STAGE,
  normalizeStage,
  stageLabel,
  coolReadyMs,
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
/** 入力中の評価（core/tastings.js の emptyTastingInput の形） */
let state = null;
/** 開いている温度帯（B5） */
let stage = DEFAULT_STAGE;
/** 温度帯ごとの保存済みの評価 { hot, warm, cool } */
let byStage = {};
/** 保存していない入力があるか（温度帯を切り替えるときに確かめる） */
let dirty = false;

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
  dirty = true;
  showErrors({});
  showMessage('', 'ok');
};

// ---- 温度帯の切り替え（B5） ----

const STAGE_HINTS = {
  hot: '淹れたての熱い味です',
  warm: '抽出の直後に入れる、いちばん大事な評価です。次の1杯の直し方はこの評価から出します',
  cool: '落ち切って15分ほどたち、冷めてきた味です。冷めると酸味や甘さ、雑味がはっきりします',
};

function renderStageTabs() {
  $('stageTabs').replaceChildren(
    ...STAGES.map((s) =>
      el(
        'button',
        { type: 'button', class: 'seg', 'aria-pressed': String(stage === s.key), onclick: () => switchStage(s.key) },
        s.label,
        byStage[s.key] ? el('span', { class: 'stage-done' }, '済') : '',
      ),
    ),
  );
  $('stageHint').textContent = STAGE_HINTS[stage];
}

function switchStage(next) {
  if (next === stage) return;
  if (dirty && !confirm('保存していない入力は消えます。温度帯を切り替えますか？')) return;
  stage = next;
  const url = new URL(location.href);
  url.searchParams.set('stage', stage);
  url.searchParams.delete('saved');
  history.replaceState(null, '', url);
  $('savedCard').hidden = true;
  loadStage();
}

/** 開いている温度帯の評価を入力欄に出す */
function loadStage() {
  const existing = byStage[stage];
  state = tastingInput(existing);
  $('save').textContent = existing ? '評価を直して保存する' : '評価を保存する';
  $('formTitle').textContent = stage === DEFAULT_STAGE ? '味の評価' : `味の評価（${stageLabel(stage)}）`;
  renderStageTabs();
  renderForm();
  showErrors({});
  showMessage('', 'ok');
  dirty = false;
}

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
    const saved = await saveTasting(db, brew.id, value, new Date(), { stage });
    byStage = { ...byStage, [stage]: saved };
    dirty = false;
    autosaveAfterChange(db); // PC の自動保存（X1）。画面は移らないので待たない
    let suggestion = null;
    if (stage === DEFAULT_STAGE) {
      // 次の1杯の直し方は、主な評価（温かいうち）からだけ出す（D-104）
      try {
        suggestion = await saveSuggestionForBrew(db, brew.id);
      } catch (err) {
        console.error(err); // 提案が作れなくても評価は保存できている
      }
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
  $('noSuggest').hidden = Boolean(s) || stage !== DEFAULT_STAGE;
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
  const title = stage === DEFAULT_STAGE ? '評価を保存しました' : `${stageLabel(stage)}の評価を保存しました`;
  $('doneTitle').textContent = title;
  document.title = `${title} - Pourfolio`;
  $('doneBrew').textContent = [bean?.name, brewLine(brew)].filter(Boolean).join('　');
  $('doneSummary').textContent = tastingSummary(saved) || 'メモだけ';
  $('save').textContent = '評価を直して保存する';
  $('savedCard').hidden = true;
  renderStageTabs();
  renderStageList();
  renderCoolCard();
  if (bean) {
    $('doneBean').href = `bean.html?id=${encodeURIComponent(bean.id)}`;
    $('doneBean').hidden = false;
  }
  window.scrollTo(0, 0);
}

/** 保存したあと：温度帯ごとの評価の一覧（2つ以上あるときだけ） */
function renderStageList() {
  const rows = STAGES.filter((s) => byStage[s.key]);
  $('stageListCard').hidden = rows.length < 2;
  $('stageList').replaceChildren(
    ...rows.map((s) => el('li', {}, el('strong', {}, s.label), el('span', {}, tastingSummary(byStage[s.key]) || 'メモだけ'))),
  );
}

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 保存したあと：冷めた味の評価への案内（B5）。冷めてからの評価がまだのときだけ */
function renderCoolCard() {
  const show = stage !== 'cool' && !byStage.cool;
  $('coolCard').hidden = !show;
  if (!show) return;
  const ready = coolReadyMs(brew);
  $('coolText').textContent =
    ready != null && Date.now() < ready
      ? `${hhmm(ready)}ごろ（落ち切って15分後）に、冷めた味も評価できます。そのころトップにお知らせが出ます`
      : '冷めてきたら、冷めた味も評価できます。味の変わり方がわかります';
  $('coolLink').href = `tasting.html?brew=${encodeURIComponent(brew.id)}&stage=cool`;
}

function showForm() {
  $('doneView').hidden = true;
  $('formView').hidden = false;
  document.title = '味の評価 - Pourfolio';
  window.scrollTo(0, 0);
}

// ---- 写真（A7） ----

async function renderPhotos() {
  const by = await getPhotosForBrew(db, brew.id);
  $('photos').replaceChildren(
    ...PHOTO_SLOTS.map((slot) => {
      const p = by[slot.key];
      const inputId = `photo-${slot.key}`;
      const input = el('input', {
        type: 'file',
        accept: 'image/*',
        id: inputId,
        class: 'visually-hidden',
        onchange: (e) => onPickPhoto(slot, e.target.files?.[0]),
      });
      return el(
        'div',
        { class: 'photo-slot' },
        el('strong', {}, slot.label),
        p
          ? el('img', {
              src: p.dataUrl,
              alt: `${slot.label}の写真`,
              class: 'photo-thumb',
              onclick: (e) => e.target.classList.toggle('zoom'), // 押すと大きく
            })
          : el('span', { class: 'photo-empty muted small' }, slot.hint),
        el('label', { class: 'btn secondary small', for: inputId }, p ? '撮り直す' : '撮る・選ぶ'),
        input,
        p ? el('button', { type: 'button', class: 'link-btn small', onclick: () => onDeletePhoto(slot, p) }, '消す') : '',
      );
    }),
  );
  $('photoCard').hidden = false;
}

async function onPickPhoto(slot, file) {
  if (!file) return;
  showMessage('写真を小さくしています…', 'muted', 'photoMsg');
  try {
    const shrunk = await shrinkImageFile(file);
    await savePhoto(db, { brewId: brew.id, slot: slot.key, ...shrunk });
    showMessage(`${slot.label}の写真を保存しました`, 'ok', 'photoMsg');
  } catch (err) {
    console.error(err);
    showMessage(err.message?.includes('写真') || err.message?.includes('画像') ? err.message : '写真を保存できませんでした', 'error', 'photoMsg');
  }
  await renderPhotos();
}

async function onDeletePhoto(slot, photo) {
  if (!confirm(`${slot.label}の写真を消しますか？元に戻せません`)) return;
  await deletePhoto(db, photo.id);
  showMessage(`${slot.label}の写真を消しました`, 'ok', 'photoMsg');
  await renderPhotos();
}

// ---- TDS・抽出収率（A8） ----

async function renderTds() {
  const table = retentionTable(await listBrews(db));
  const m = brewMetrics(brew, table);
  $('tdsInput').value = m.tdsPct ?? '';
  $('tdsResult').textContent =
    m.tdsPct == null
      ? ''
      : m.eyPct == null
        ? `TDS ${m.tdsPct}%（抽出液の量が分からないので収率は出せません）`
        : `抽出収率 ${m.eyPct}%（抽出液 ${m.beverageG}g${m.beverageEstimated ? '・見積もり' : ''}）`;
  $('tdsCard').hidden = false;
}

// ---- 抽出レポートの1枚画像（X3） ----

let imageFile = null;
let imageUrl = null;

async function makeImage() {
  $('imageMake').disabled = true;
  try {
    const [stages, brews, equipment, recipe] = await Promise.all([
      getTastingsByStage(db, brew.id),
      listBrews(db),
      listEquipment(db),
      brew.recipeId ? getRecipe(db, brew.recipeId) : null,
    ]);
    const content = brewImageContent({
      brew,
      bean,
      tasting: stages[DEFAULT_STAGE] ?? null,
      recipeName: recipe?.name ?? brew.planned?.name ?? '',
      grinderName: equipment.find((e) => e.id === brew.actual?.grind?.grinderId)?.name ?? '',
      metrics: brewMetrics(brew, retentionTable(brews)),
      withMemo: $('imageMemo').checked,
    });
    const cv = drawBrewImage(content);
    imageFile = await canvasToFile(cv, imageFileName(brew.at));
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = URL.createObjectURL(imageFile);
    $('imagePreview').src = imageUrl;
    $('imagePreview').hidden = false;
    $('imageDownload').href = imageUrl;
    $('imageDownload').download = imageFile.name;
    $('imageShare').hidden = !(navigator.canShare && navigator.canShare({ files: [imageFile] }));
    $('imageActions').hidden = false;
    $('imageMake').textContent = '作り直す';
    showMessage('', 'ok', 'imageMsg');
  } catch (err) {
    console.error(err);
    showMessage('画像を作れませんでした', 'error', 'imageMsg');
  } finally {
    $('imageMake').disabled = false;
  }
}

async function shareImage() {
  try {
    await navigator.share({ files: [imageFile], title: imageFile.name });
  } catch (err) {
    if (err?.name !== 'AbortError') showMessage('共有できませんでした。「ダウンロード」を使ってください', 'error', 'imageMsg');
  }
}

async function onSaveTds() {
  const { value, error } = normalizeTds($('tdsInput').value);
  if (error) {
    showMessage(error, 'error', 'tdsMsg');
    return;
  }
  brew = await setBrewTds(db, brew.id, value);
  showMessage(value == null ? 'TDSを消しました' : 'TDSを保存しました', 'ok', 'tdsMsg');
  await renderTds();
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
  byStage = await getTastingsByStage(db, brew.id);
  stage = normalizeStage(queryParam('stage'));

  const a = brew.actual ?? {};
  $('sub').textContent = [bean?.name ?? '豆なし', brewLine(brew), a.totalSec != null ? formatSec(a.totalSec) : ''].filter(Boolean).join('　');
  if (queryParam('saved') === '1' && !byStage.warm && stage === DEFAULT_STAGE) await showSavedStock();
  loadStage();
  $('formView').hidden = false;
  await renderPhotos();
  await renderTds();
  $('imageCard').hidden = false;
}

$('imageMake').addEventListener('click', makeImage);
$('imageShare').addEventListener('click', shareImage);

$('tdsSave').addEventListener('click', onSaveTds);
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
