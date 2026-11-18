// 今日の一杯（F3）と気分プリセット（F4）：上位3つの豆を理由と一緒に出し、選んだ気分で淹れる画面に進む
import { openDb, readAll, getSettings, updateSettings } from './db.js';
import { beanRows } from './core/home.js';
import { todayPicks, pickHref, baseText, caffeineState, normalizeCutoff, DAILY_CAFFEINE_MG } from './core/today.js';
import { MOODS, moodForHour, cupsLabel } from './core/plan-adjust.js';
import { analysisRows } from './core/analysis.js';
import { dailyStats } from './core/calendar.js';
import { doseFromSettings } from './core/inventory.js';
import { localYmd } from './core/format.js';
import { $, el, queryParam, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
let data = null;
let settings = null;
const now = new Date();
// 気分の初期値：URL（?mood=）→ 時間帯（朝は目覚め、夜は くつろぎ）
let mood = queryParam('mood') === 'none' ? null : MOODS[queryParam('mood')] ? queryParam('mood') : moodForHour(now.getHours());

function todayCaffeine() {
  return dailyStats(analysisRows(data)).get(localYmd(now))?.caffeineMg ?? 0;
}

function renderMood() {
  const seg = (label, key) =>
    el('button', { type: 'button', class: 'seg', 'aria-pressed': String(mood === key), onclick: () => setMood(key) }, label);
  $('moodSeg').replaceChildren(seg('なし', null), ...Object.entries(MOODS).map(([k, m]) => seg(m.label, k)));
  const m = MOODS[mood];
  $('moodNote').textContent = m
    ? `狙い：${m.aim}。${m.ratioDelta ? `比率を${m.ratioDelta > 0 ? '+' : '−'}${Math.abs(m.ratioDelta)}${m.taste || m.strength ? '、4:6の配分も' : ''}変えて淹れます` : '数字は変えずに2杯ぶんにします'}`
    : '気分を選ぶと、合う豆を少し上げ、淹れ方の比率を変えます';
}

function setMood(key) {
  mood = key;
  const q = new URLSearchParams(location.search);
  q.set('mood', key ?? 'none');
  history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
  render();
}

function pickCard(p, i) {
  return el(
    'section',
    { class: `card${i === 0 ? ' suggest-card' : ''}` },
    el('div', { class: 'bean-card-top' }, el('h2', {}, `${i + 1}. ${p.bean.name}`), el('span', { class: 'pill tag num' }, `★${p.predicted.toFixed(1)}の目安`)),
    el('p', { class: 'muted' }, [p.bean.roastLevel, p.bean.decaf ? 'カフェインレス' : ''].filter(Boolean).join('・')),
    el('ul', { class: 'reason-list' }, ...p.reasons.map((t) => el('li', {}, t))),
    el('p', { class: 'muted small' }, `淹れ方：${baseText(p)}${p.cups !== 1 ? `、${cupsLabel(p.cups)}` : ''}`),
    el('div', { class: 'row' }, el('a', { class: `btn${i === 0 ? '' : ' secondary'}`, href: pickHref(p) }, 'これで淹れる')),
  );
}

function render() {
  renderMood();
  const doseG = doseFromSettings(settings);
  const rows = beanRows({ beans: data.beans, txs: data.inventoryTx, portions: data.frozenPortions, doseG, today: localYmd(now) });
  const caf = todayCaffeine();
  const picks = todayPicks({ rows, brews: data.brews, tastings: data.tastings, beans: data.beans, now, mood, cutoff: settings.caffeineCutoff ?? null, todayCaffeineMg: caf });
  if (!picks.length) {
    $('picks').replaceChildren(
      el(
        'section',
        { class: 'card' },
        el('p', {}, '1杯ぶん以上残っている豆がありません。'),
        el('div', { class: 'row' }, el('a', { class: 'btn', href: 'bean-edit.html' }, '豆を登録する'), el('a', { class: 'btn secondary', href: 'beans.html' }, '豆と在庫')),
      ),
    );
  } else {
    $('picks').replaceChildren(...picks.map(pickCard));
  }
  const state = caffeineState({ now, cutoff: settings.caffeineCutoff ?? null, todayCaffeineMg: caf });
  $('cafToday').textContent = `今日のカフェインは約${caf}mg（1日の目安 ${DAILY_CAFFEINE_MG}mg）。${state.late ? state.why : '今は控える時間ではありません'}`;
  $('cutoff').value = settings.caffeineCutoff ?? '';
  $('cutoffClear').hidden = !settings.caffeineCutoff;
}

async function saveCutoff(value) {
  const v = value ? normalizeCutoff(value) : null;
  settings = await updateSettings(db, { caffeineCutoff: v });
  showMessage(v ? `${v}から控えるようにしました` : '控える時刻を使わないようにしました');
  render();
}

$('cutoff').addEventListener('change', (e) => saveCutoff(e.target.value).catch(() => showMessage('保存できませんでした', 'error')));
$('cutoffClear').addEventListener('click', () => saveCutoff(null).catch(() => showMessage('保存できませんでした', 'error')));

async function init() {
  [data, settings] = await Promise.all([readAll(db), getSettings(db)]);
  render();
}

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  $('picks').replaceChildren(el('p', { class: 'muted' }, '読み込みに失敗しました。開き直してください'));
});
