// AI相談テキスト（F5）：記録の要約と質問をコピーし、AIの答えの「提案レシピ」を読み取って淹れる画面に進む
import { openDb, readAll, getSettings } from './db.js';
import { buildConsultText, parseAnswer, findBeanByName, QUESTIONS } from './core/ai-text.js';
import { adjustQuery } from './core/plan-adjust.js';
import { bestBrewOf } from './core/today.js';
import { beanRows } from './core/home.js';
import { pickTasting } from './core/tastings.js';
import { sortBeansForList } from './core/beans.js';
import { doseFromSettings } from './core/inventory.js';
import { localYmd, formatG } from './core/format.js';
import { $, el, queryParam, showMessage, copyBySelection } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const alive = (r) => r && r.deletedAt == null;
let data = null;
let rows = [];
let usable = [];
let question = QUESTIONS[queryParam('q')] ? queryParam('q') : 'next';
let parsed = null;

function fillBeans(select, selectedId) {
  select.replaceChildren(...usable.map((b) => el('option', { value: b.id }, [b.name, b.roastLevel].filter(Boolean).join('　'))));
  if (selectedId && usable.some((b) => b.id === selectedId)) select.value = selectedId;
}

function renderQuestions() {
  $('questions').replaceChildren(
    ...Object.entries(QUESTIONS).map(([k, q]) =>
      el(
        'label',
        { class: 'check-row' },
        el('input', {
          type: 'radio',
          name: 'question',
          value: k,
          checked: question === k,
          onchange: () => {
            question = k;
            renderText();
          },
        }),
        el('span', {}, q.label),
      ),
    ),
  );
}

function currentText() {
  const bean = usable.find((b) => b.id === $('bean').value) ?? null;
  return buildConsultText({
    question,
    extra: $('extra').value,
    bean,
    brews: data.brews,
    tastings: data.tastings,
    beans: data.beans.filter(alive),
    rows,
    equipment: data.equipment,
    now: new Date(),
  });
}

function renderText() {
  $('beanRow').hidden = question !== 'bean';
  $('text').value = currentText();
  $('answerCard').hidden = !QUESTIONS[question].recipe;
}

/** 画面に見えない入力欄に文章を入れて選び、コピーの命令を出す（クリップボードの機能が使えないブラウザ用） */
async function copy() {
  const text = currentText();
  $('text').value = text;
  const done = () => showMessage(`コピーしました（${text.length}文字）。チャットAIの入力欄に貼り付けてください`, 'ok', 'copyMsg');
  try {
    await navigator.clipboard.writeText(text);
    done();
  } catch {
    if (copyBySelection(text)) {
      done();
      return;
    }
    // クリップボードが使えないとき：文章を選んだ状態にして、手でコピーしてもらう
    $('text').closest('details').open = true;
    $('text').focus();
    $('text').select();
    showMessage('自動でコピーできませんでした。選んだ文章を長押しして「コピー」を押してください', 'error', 'copyMsg');
  }
}

/** 豆の土台：その豆で★がいちばん高かった杯 → 前回の杯 → 初期レシピ */
function baseFor(beanId) {
  const own = data.brews
    .filter((b) => alive(b) && b.beanId === beanId)
    .map((b) => ({ brew: b, stars: pickTasting(data.tastings, b.id)?.stars ?? null }))
    .filter((x) => x.stars != null);
  const best = bestBrewOf(own);
  if (best) return { q: `brew=${encodeURIComponent(best.id)}`, text: 'この豆でいちばん★が高かった杯の注ぎ方に、読み取った数字を入れます' };
  if (data.brews.some(alive)) return { q: 'from=last', text: '前回の杯の注ぎ方に、読み取った数字を入れます' };
  return { q: `initial=${encodeURIComponent(beanId)}`, text: 'この豆の最初のレシピの注ぎ方に、読み取った数字を入れます' };
}

function renderLink() {
  const beanId = $('answerBean').value;
  if (parsed && !beanId) {
    // 手元に豆がないと淹れる画面を開けないので、押せないボタンにせず案内を出す（2-8の44番）
    $('answerBase').textContent = '手元に豆がありません。先に「豆と在庫」で豆を登録してください';
    $('brewLink').textContent = '豆を登録する';
    $('brewLink').href = 'bean-edit.html';
    return;
  }
  if (!parsed || !beanId) return;
  $('brewLink').textContent = 'この計画で淹れる';
  const base = baseFor(beanId);
  $('answerBase').textContent = base.text;
  // AIの湯量はお湯の量なので、土台の杯がアイスでもホットで開く（iced=0。抽出の画面でアイスにもできる）
  $('brewLink').href = `brew.html?${base.q}&bean=${encodeURIComponent(beanId)}&via=ai&${adjustQuery({ overrides: parsed.overrides, iced: false }, true)}`;
}

function onParse() {
  parsed = parseAnswer($('answer').value);
  $('parsed').hidden = !parsed.found;
  if (!parsed.found) {
    showMessage('粉量・湯量・湯温・挽き目が読み取れませんでした。「【提案レシピ】」の部分を含めて貼ってください', 'error');
    return;
  }
  const o = parsed.overrides;
  const item = (label, v) => el('div', { class: 'plan-item' }, el('span', { class: 'muted' }, label), el('span', { class: 'num plan-value' }, v ?? '—'));
  $('parsedPlan').replaceChildren(
    item('粉量', o.doseG != null ? formatG(o.doseG) : null),
    item('湯量', o.waterG != null ? formatG(o.waterG) : null),
    item('湯温', o.tempC != null ? `${o.tempC}℃` : null),
    item('挽き目', o.grind ?? null),
  );
  $('parsedReason').textContent = parsed.reason ? `理由：${parsed.reason}` : '';
  const hit = findBeanByName(parsed.beanName, usable);
  fillBeans($('answerBean'), hit?.id ?? $('bean').value);
  const missing = Object.keys(o).length < 4;
  showMessage(
    ['読み取りました', missing ? '—（読めなかった項目）はいつもの値のままです' : '', parsed.beanName && !hit ? `豆「${parsed.beanName}」は手元の豆に見つからなかったので、選んでください` : '']
      .filter(Boolean)
      .join('。'),
  );
  renderLink();
}

async function init() {
  const [all, settings] = await Promise.all([readAll(db), getSettings(db)]);
  data = all;
  rows = beanRows({ beans: all.beans, txs: all.inventoryTx, portions: all.frozenPortions, doseG: doseFromSettings(settings), today: localYmd() });
  usable = sortBeansForList(all.beans.filter((b) => alive(b) && b.status !== 'finished' && b.status !== 'ordered'));
  fillBeans($('bean'), queryParam('bean') ?? rows[0]?.bean.id);
  renderQuestions();
  renderText();
}

$('bean').addEventListener('change', renderText);
$('extra').addEventListener('input', renderText);
$('copy').addEventListener('click', () => copy());
$('parse').addEventListener('click', onParse);
$('answerBean').addEventListener('change', renderLink);

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込めませんでした。開き直してください', 'error', 'copyMsg');
});
