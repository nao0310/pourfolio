// 味の評価の画面：クイック評価（B1）とちょうど良さ評価（JAR、B2）
// tasting.html?brew=<抽出のID>（抽出を保存した直後は &saved=1 が付き、豆の残量を上に出す）
import { openDb, getBrew, getTastingForBrew, saveTasting, getBeanWithTx, getSettings } from './db.js';
import {
  STAR_MAX,
  QUICK_TAGS,
  JAR_ATTRS,
  allJustJar,
  tastingInput,
  normalizeTastingInput,
  tastingSummary,
  brewLine,
} from './core/tastings.js';
import { formatSec } from './core/recipes.js';
import { remainingG, cupsLeft, doseFromSettings } from './core/inventory.js';
import { formatG } from './core/format.js';
import { $, el, queryParam, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
let brew = null;
let bean = null;
/** 入力中の評価 { stars, tags, jar, memo } */
let state = null;

// ---- 入力の部品 ----

function renderStars() {
  const box = $('stars');
  box.replaceChildren(
    ...Array.from({ length: STAR_MAX }, (_, i) => {
      const n = i + 1;
      const on = state.stars != null && n <= state.stars;
      return el(
        'button',
        {
          type: 'button',
          class: `star${on ? ' on' : ''}`,
          'aria-label': `★${n}`,
          'aria-pressed': String(state.stars === n),
          onclick: () => {
            state.stars = state.stars === n ? null : n; // 同じ★をもう一度押すと消える
            renderStars();
            clearErrors();
          },
        },
        on ? '★' : '☆',
      );
    }),
    el('span', { class: 'star-count num' }, state.stars != null ? `${state.stars} / ${STAR_MAX}` : '未選択'),
  );
}

function renderTags() {
  $('tags').replaceChildren(
    ...QUICK_TAGS.map((t) =>
      el(
        'label',
        { class: 'chip' },
        el('input', {
          type: 'checkbox',
          checked: state.tags.includes(t),
          onchange: (e) => {
            state.tags = e.target.checked ? [...state.tags, t] : state.tags.filter((x) => x !== t);
            clearErrors();
          },
        }),
        el('span', {}, t),
      ),
    ),
  );
}

function renderJar() {
  $('jar').replaceChildren(
    ...JAR_ATTRS.map((a) => {
      const cur = state.jar[a.key];
      return el(
        'div',
        { class: 'jar-row', role: 'group', 'aria-label': a.label },
        el('div', { class: 'jar-label' }, el('strong', {}, a.label), el('span', { class: 'muted' }, cur == null ? '未回答' : a.words[cur + 2])),
        el(
          'div',
          { class: 'seg5' },
          ...a.words.map((w, i) => {
            const v = i - 2;
            return el(
              'button',
              {
                type: 'button',
                class: `seg${v === 0 ? ' just' : ''}`,
                'aria-pressed': String(cur === v),
                onclick: () => {
                  state.jar[a.key] = cur === v ? null : v; // 同じボタンをもう一度押すと未回答に戻る
                  renderJar();
                  clearErrors();
                },
              },
              w,
            );
          }),
        ),
      );
    }),
  );
}

function renderForm() {
  renderStars();
  renderTags();
  renderJar();
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
    showDone(saved);
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error');
  } finally {
    $('save').disabled = false;
  }
}

function showDone(saved) {
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
    const rest = remainingG(loaded?.txs ?? []);
    const dose = doseFromSettings(await getSettings(db));
    $('savedStock').textContent = `${bean.name}の残り ${formatG(rest)}（あと${cupsLeft(rest, dose)}杯）`;
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
  renderJar();
  clearErrors();
});
$('edit').addEventListener('click', showForm);

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込みに失敗しました', 'error');
});
