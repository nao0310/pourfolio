// 天気の地点（X16）：地点（都道府県庁所在地か緯度・経度）と暑い日の線を決め、いまの天気と、天気の付いた杯の数を見る
import { openDb, getSettings, updateSettings, listBrews } from './db.js';
import { PLACES, normalizePlace, placeOf, hotLineOf, hotDay, weatherAt, weatherText, brewWeather, HOT_C_RANGE, DEFAULT_HOT_C } from './core/weather.js';
import { syncWeather, clearWeatherCache } from './weather-sync.js';
import { autosaveAfterChange } from './autosave-file.js';
import { formatDateTimeJa } from './core/format.js';
import { $, el, showMessage, stepperField } from './ui.js';
import { registerServiceWorker } from './pwa.js';

registerServiceWorker();
const db = openDb();
let settings = null;
let hotValue = DEFAULT_HOT_C;

const form = $('placeForm');

function fillSelect() {
  $('placeKey').replaceChildren(
    el('option', { value: '' }, '決めない（天気を使わない）'),
    ...PLACES.map((p) => el('option', { value: p.key }, p.name)),
    el('option', { value: 'custom' }, '緯度・経度を手で入れる'),
  );
}

function showCustom() {
  $('customBox').hidden = $('placeKey').value !== 'custom';
}

function showErrors(errors) {
  for (const node of form.querySelectorAll('.field-error')) node.textContent = errors[node.dataset.for] ?? '';
}

function fillForm() {
  const p = placeOf(settings);
  $('placeKey').value = p ? (PLACES.some((x) => x.key === p.key) ? p.key : 'custom') : '';
  if (p && $('placeKey').value === 'custom') {
    form.elements.name.value = p.name;
    form.elements.lat.value = String(p.lat);
    form.elements.lon.value = String(p.lon);
  }
  showCustom();
}

const hot = stepperField({
  id: 'hotC',
  label: '今日の最高気温が',
  unit: '℃以上',
  step: 1,
  min: HOT_C_RANGE.min,
  max: HOT_C_RANGE.max,
  errorFor: 'hotC',
  onValue: (n) => {
    hotValue = n;
  },
});
$('hotField').append(hot.node);

async function renderState({ force = false } = {}) {
  const place = placeOf(settings);
  $('refresh').hidden = !place;
  if (!place) {
    $('state').replaceChildren(el('p', { class: 'muted' }, '地点を決めていません。天気は問い合わせず、杯にも付けません。'));
    return;
  }
  $('state').replaceChildren(el('p', { class: 'muted' }, '天気を確かめています…'));
  const brews = await listBrews(db);
  const now = new Date();
  const { cache, filled, error } = await syncWeather(db, { settings, brews, now, force });
  const after = filled ? await listBrews(db) : brews;
  const withW = after.filter((b) => brewWeather(b)).length;
  const items = [el('dt', {}, '地点'), el('dd', {}, `${place.name}（${place.lat}, ${place.lon}）`)];
  if (cache) {
    const nowW = weatherAt(cache, now.toISOString());
    const d = hotDay({ cache, now, line: hotLineOf(settings) });
    items.push(
      el('dt', {}, 'いまの天気'),
      el('dd', {}, nowW ? weatherText(nowW) : 'まだ分かりません'),
      el('dt', {}, '今日の最高気温'),
      el('dd', { class: 'num' }, d.maxC == null ? 'まだ分かりません' : `${d.maxC}℃${d.hot ? '（暑い日）' : ''}`),
      el('dt', {}, '受け取った時刻'),
      el('dd', {}, formatDateTimeJa(cache.fetchedAt)),
    );
  }
  items.push(el('dt', {}, '天気の付いた杯'), el('dd', { class: 'num' }, `${withW}杯／${after.length}杯${filled ? `（いま${filled}杯に付けました）` : ''}`));
  $('state').replaceChildren(
    el('dl', { class: 'plan-numbers' }, ...items),
    el('p', { class: 'muted small' }, '天気は過去92日までさかのぼって付けます。それより前に淹れた杯や、地点を決める前の古い杯には付きません。'),
  );
  if (error) showMessage(error, 'error', 'stateMsg');
  else if (force) showMessage('天気を取り直しました', 'ok', 'stateMsg');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = Object.fromEntries(new FormData(form));
  const { value, errors } = normalizePlace(raw);
  showErrors(errors);
  if (Object.keys(errors).length) {
    showMessage('赤い文字のところを直してください', 'error', 'placeMsg');
    return;
  }
  const before = placeOf(settings);
  settings = await updateSettings(db, { weatherPlace: value });
  if (!value) clearWeatherCache();
  await autosaveAfterChange(db);
  showMessage(value ? `地点を「${value.name}」にしました` : '地点を消しました。天気は問い合わせません', 'ok', 'placeMsg');
  const changed = !before || !value || before.lat !== value.lat || before.lon !== value.lon;
  await renderState({ force: !!value && changed });
});

$('placeKey').addEventListener('change', showCustom);

$('hotSave').addEventListener('click', async () => {
  const errEl = $('hotCard').querySelector('.field-error');
  if (!(hotValue >= HOT_C_RANGE.min && hotValue <= HOT_C_RANGE.max)) {
    errEl.textContent = `${HOT_C_RANGE.min}〜${HOT_C_RANGE.max}℃で入れてください`;
    return;
  }
  errEl.textContent = '';
  settings = await updateSettings(db, { hotDayC: Math.round(hotValue) });
  await autosaveAfterChange(db);
  showMessage(`最高気温${Math.round(hotValue)}℃以上の日にアイスをすすめます`, 'ok', 'hotMsg');
  await renderState();
});

$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  try {
    await renderState({ force: true });
  } finally {
    $('refresh').disabled = false;
  }
});

async function init() {
  fillSelect();
  settings = await getSettings(db);
  fillForm();
  hotValue = hotLineOf(settings);
  hot.set(hotValue);
  await renderState();
}

init().catch((err) => {
  console.error(err);
  $('state').replaceChildren(el('p', { class: 'error' }, '読み込めませんでした。開き直してください'));
});
