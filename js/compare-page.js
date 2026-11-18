// 焙煎度比較モード（X27）の画面
// compare.html            一覧・わかった好み・新しく始める（?bean=ID でその豆の組を選んでおく）
// compare.html?id=<ID>    飲み比べ1回：1. 淹れる → 2. 飲み比べる（ブラインドは番号で）→ 3. 答え合わせ → 結果
import {
  openDb,
  listBeans,
  listRecipes,
  listExperiments,
  getExperiment,
  addExperiment,
  updateExperiment,
  finishExperiment,
  deleteExperiment,
  getLastBrew,
} from './db.js';
import {
  candidateGroups,
  usableBeans,
  sortByRoast,
  normalizeCompareInput,
  buildExperiment,
  experimentStatus,
  STATUS_LABELS,
  cupCount,
  setRating,
  ratingOf,
  allRated,
  reveal,
  compareResults,
  roastPreferences,
  preferenceForBean,
  preferenceText,
  openExperiments,
  MAX_ENTRIES,
} from './core/compare.js';
import { orderRecipesForList, recipeSummary } from './core/recipes.js';
import { tastingSummary } from './core/tastings.js';
import { renderStars, renderTags } from './tasting-parts.js';
import { $, el, queryParam, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';
import { singleFlight, serialQueue } from './core/once.js';

const db = openDb();
const enc = encodeURIComponent;
let beans = [];
let exp = null;

const beanLabel = (b) => (b ? [b.roastLevel, b.name].filter(Boolean).join('　') : '（削除した豆）');
const beanOf = (id) => beans.find((b) => b.id === id) ?? null;

function showErrors(errors, root) {
  for (const node of root.querySelectorAll('.field-error')) node.textContent = errors[node.dataset.for] ?? '';
}

// ---- 一覧と、新しく始める ----

function expLink(e) {
  const status = experimentStatus(e);
  return el(
    'li',
    {},
    el('a', { href: `compare.html?id=${enc(e.id)}` }, e.title || '焙煎度比較'),
    el('span', { class: 'muted small' }, `　${STATUS_LABELS[status]}・${e.entries.length}袋${e.blind !== false ? '・ブラインド' : ''}`),
  );
}

function checkBeans(ids) {
  for (const input of document.querySelectorAll('#beanChecks input')) input.checked = ids.includes(input.value);
}

async function showList() {
  const [recipes, experiments, last] = await Promise.all([listRecipes(db), listExperiments(db), getLastBrew(db)]);
  $('listView').hidden = false;

  const open = openExperiments(experiments);
  $('openList').replaceChildren(
    ...open.map((e) =>
      el(
        'div',
        { class: 'card resume-card' },
        el('p', {}, el('strong', {}, `${STATUS_LABELS[experimentStatus(e)]}：${e.title}`)),
        el('div', { class: 'row' }, el('a', { class: 'btn', href: `compare.html?id=${enc(e.id)}` }, '続きに戻る')),
      ),
    ),
  );

  const prefs = roastPreferences(experiments, beans);
  $('prefCard').hidden = prefs.length === 0;
  $('prefList').replaceChildren(
    ...prefs.map((p) =>
      el(
        'li',
        {},
        el('strong', {}, preferenceText(p)),
        el('span', { class: 'muted small' }, p.levels.map((l) => `${l.level} ★${l.avgStars}（${l.n}杯）`).join('・')),
      ),
    ),
  );

  const done = experiments.filter((e) => experimentStatus(e) === 'done').sort((a, b) => String(b.revealedAt).localeCompare(String(a.revealedAt)));
  $('doneCard').hidden = done.length === 0;
  $('doneList').replaceChildren(...done.map(expLink));

  // 始める：候補の組・豆・レシピ
  const groups = candidateGroups(beans);
  $('groups').replaceChildren(
    groups.length
      ? el(
          'div',
          { class: 'compare-groups' },
          el('p', { class: 'muted small' }, '焙煎度違いがそろっている豆'),
          ...groups.map((g) =>
            el(
              'button',
              { type: 'button', class: 'btn secondary small', onclick: () => checkBeans(g.beans.map((b) => b.id)) },
              `${g.name}（${g.beans.map((b) => b.roastLevel).join('・')}）`,
            ),
          ),
        )
      : el('p', { class: 'muted small' }, '同じ銘柄で焙煎度が違う袋を登録すると、ここに組が出ます。銘柄が違う袋どうしでも比べられます'),
  );
  // 銘柄の順、同じ銘柄は焙煎度の浅い順
  const usable = usableBeans(beans).sort((a, b) => a.name.localeCompare(b.name, 'ja') || (sortByRoast([a, b])[0] === a ? -1 : 1));
  $('beanChecks').replaceChildren(
    ...(usable.length
      ? usable.map((b) =>
          el('label', { class: 'check-row' }, el('input', { type: 'checkbox', value: b.id }), el('span', {}, beanLabel(b))),
        )
      : [el('p', { class: 'muted' }, '飲める豆がありません。先に豆を登録してください')]),
  );
  const ordered = orderRecipesForList(recipes, last ? [last] : []);
  $('recipe').replaceChildren(
    el('option', { value: '' }, ordered.length ? '（選ぶ）' : '（レシピが未登録）'),
    ...ordered.map((r) => el('option', { value: r.id }, `${r.name}　${recipeSummary(r)}`)),
  );
  if (ordered[0]) $('recipe').value = ordered[0].id;

  // ?bean=ID：その豆の組を選んでおく（なければその豆だけ）
  const want = queryParam('bean');
  if (want) {
    const g = groups.find((x) => x.beans.some((b) => b.id === want));
    checkBeans(g ? g.beans.map((b) => b.id) : [want]);
  }
}

// 「始める」の連打で同じ飲み比べが2件できないように（2-8 の12番）
const onStart = singleFlight(async (e) => {
  e.preventDefault();
  const beanIds = [...document.querySelectorAll('#beanChecks input:checked')].map((i) => i.value);
  const { value, errors } = normalizeCompareInput({ beanIds, recipeId: $('recipe').value, blind: $('blind').checked }, beans);
  showErrors(errors, $('startForm'));
  if (Object.keys(errors).length) {
    showMessage(beanIds.length > MAX_ENTRIES ? `比べられるのは${MAX_ENTRIES}袋までです` : '赤い文字のところを直してください', 'error');
    return;
  }
  $('start').disabled = true;
  try {
    const rec = await addExperiment(db, buildExperiment({ value, beans }));
    location.href = `compare.html?id=${enc(rec.id)}`;
  } catch (err) {
    console.error(err);
    $('start').disabled = false;
    showMessage('始められませんでした。もう一度押してください', 'error');
  }
});

// ---- 飲み比べ1回 ----

/** 1. 淹れる */
function renderEntries() {
  const blind = exp.blind !== false;
  $('brewHint').textContent = blind
    ? '1袋ずつ「淹れる」で淹れます。淹れたカップの底（またはコースター）に、焙煎度を書いた付せんを貼っておきます'
    : '1袋ずつ「淹れる」で淹れます';
  const status = experimentStatus(exp);
  $('entries').replaceChildren(
    ...exp.entries.map((e) => {
      const b = beanOf(e.beanId);
      const href = `brew.html?recipe=${enc(exp.recipeId ?? '')}&bean=${enc(e.beanId)}&compare=${enc(exp.id)}`;
      return el(
        'li',
        {},
        el('span', { class: 'compare-bean' }, beanLabel(b)),
        e.brewId
          ? el('span', { class: 'compare-done' }, '淹れた', status !== 'done' ? el('a', { class: 'small', href }, '淹れ直す') : '')
          : el('a', { class: 'btn small', href }, '淹れる'),
      );
    }),
  );
}

/** メモの保存待ち（カップごと）。打ち終わって0.5秒で保存する。結果を出す前には待たずに保存する（2-8 の11番） */
const memoWaits = new Map();
/** 評価の保存は1つずつ順番に（古い中身から作った保存が、新しい保存を上書きしないように） */
const ratingQueue = serialQueue();

/** カップ1つの評価を保存する（入力のたびに） */
function saveRating(key, rating) {
  return ratingQueue
    .run(async () => {
      exp = await updateExperiment(db, exp.id, { ratings: setRating(exp, key, rating) });
      showErrors({}, $('revealCard'));
    })
    .catch((err) => {
      console.error(err);
      showMessage('★やメモを保存できませんでした。もう一度入れてください', 'error', 'rMsg');
    });
}

/** 保存待ちのメモを今すぐ保存し、全部の保存が終わるのを待つ */
async function flushRatings() {
  for (const [key, w] of memoWaits) {
    clearTimeout(w.timer);
    memoWaits.delete(key);
    w.run();
  }
  await ratingQueue.idle();
}

/** 2. 飲み比べる：ブラインドなら番号、そうでなければ袋ごとに★・一言・メモ */
function renderCups() {
  const blind = exp.blind !== false;
  $('tasteHint').textContent = blind
    ? `底を見ないようにカップを混ぜて並べ、左から1〜${cupCount(exp)}番とします。番号ごとに★を付けます（一言・メモは入れなくてもよい）`
    : '袋ごとに★を付けます（一言・メモは入れなくてもよい）';
  const keys = blind ? exp.entries.map((_, i) => i + 1) : exp.entries.map((e) => e.beanId);
  $('cups').replaceChildren(
    ...keys.map((key) => {
      const state = ratingOf(exp, key);
      const save = () => saveRating(key, state);
      const stars = el('div', { class: 'stars', role: 'group', 'aria-label': '★' });
      const tags = el('div', { class: 'chips' });
      renderStars(stars, state, save);
      renderTags(tags, state, save);
      const memo = el('textarea', {
        rows: '1',
        'aria-label': 'メモ',
        placeholder: 'メモ',
        oninput: (ev) => {
          state.memo = ev.target.value;
          clearTimeout(memoWaits.get(key)?.timer);
          memoWaits.set(key, { run: save, timer: setTimeout(() => (memoWaits.delete(key), save()), 500) });
        },
      });
      memo.value = state.memo;
      return el(
        'div',
        { class: 'cup-block' },
        el('h3', {}, blind ? `カップ ${key}` : beanLabel(beanOf(key))),
        stars,
        tags,
        memo,
      );
    }),
  );
}

/** 3. 答え合わせ（ブラインド）／結果を見る（ブラインドでない） */
function renderReveal() {
  const blind = exp.blind !== false;
  $('revealTitle').textContent = blind ? '3. 答え合わせ' : '3. 結果を見る';
  $('revealHint').textContent = blind ? '全部に★を付けたら、カップの底を見て、番号ごとに焙煎度を選びます' : '全部に★を付けたら押します';
  $('answers').replaceChildren(
    ...(blind
      ? exp.entries.map((_, i) =>
          el(
            'label',
            { class: 'field answer-row' },
            el('span', { class: 'label' }, `カップ ${i + 1}`),
            el(
              'select',
              { 'data-cup': String(i + 1) },
              el('option', { value: '' }, '（底に書いた焙煎度）'),
              ...exp.entries.map((e) => el('option', { value: e.beanId }, beanLabel(beanOf(e.beanId)))),
            ),
          ),
        )
      : []),
  );
}

async function onReveal() {
  await flushRatings(); // 打ったばかりのメモも結果に入れる
  const blind = exp.blind !== false;
  let ratings;
  if (blind) {
    const answers = Object.fromEntries([...document.querySelectorAll('#answers select')].map((s) => [s.dataset.cup, s.value || null]));
    const r = reveal(exp, answers);
    showErrors(r.errors, $('revealCard'));
    if (!r.ratings) {
      showMessage('赤い文字のところを直してください', 'error', 'rMsg');
      return;
    }
    ratings = r.ratings;
  } else {
    if (!allRated(exp)) {
      showErrors({ ratings: 'どの袋にも★を付けてください' }, $('revealCard'));
      return;
    }
    ratings = exp.ratings;
  }
  $('reveal').disabled = true;
  try {
    exp = await finishExperiment(db, exp.id, ratings);
    await renderExp();
    $('resultCard').scrollIntoView({ block: 'start' });
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error', 'rMsg');
  } finally {
    $('reveal').disabled = false;
  }
}

/** 結果：★の多い順。この産地の好み */
async function renderResults() {
  const rows = compareResults(exp, beans);
  const tastings = (await db.table('tastings').toArray()).filter((t) => t.deletedAt == null && t.experimentId === exp.id);
  $('results').replaceChildren(
    ...rows.map((r) => {
      const brewId = exp.entries.find((e) => e.beanId === r.beanId)?.brewId;
      const t = tastings.find((x) => x.brewId === brewId && (x.stage ?? 'warm') === 'warm');
      return el(
        'li',
        {},
        el('span', { class: 'num compare-rank' }, r.rank != null ? `${r.rank}位` : '—'),
        el(
          'span',
          { class: 'compare-result-body' },
          brewId ? el('a', { href: `tasting.html?brew=${enc(brewId)}` }, beanLabel(r.bean)) : beanLabel(r.bean),
          el('span', { class: 'muted small' }, [r.cupNo != null ? `カップ${r.cupNo}` : '', tastingSummary(t ?? r)].filter(Boolean).join('　')),
        ),
      );
    }),
  );
  const prefs = roastPreferences(await listExperiments(db), beans);
  const first = rows[0]?.bean;
  $('prefText').textContent = first ? preferenceText(preferenceForBean(prefs, first)) : '';
}

async function renderExp() {
  const status = experimentStatus(exp);
  $('title').textContent = exp.title || '焙煎度比較';
  document.title = `${exp.title} - Pourfolio`;
  const recipe = exp.recipeId ? await db.table('recipes').get(exp.recipeId) : null;
  $('sub').textContent = [recipe ? `レシピ：${recipe.name}` : '', exp.blind !== false ? 'ブラインド' : '', STATUS_LABELS[status]].filter(Boolean).join('・');
  renderEntries();
  $('tasteCard').hidden = status !== 'tasting';
  $('revealCard').hidden = status !== 'tasting';
  $('resultCard').hidden = status !== 'done';
  if (status === 'tasting') {
    renderCups();
    renderReveal();
  }
  if (status === 'done') await renderResults();
  $('expView').hidden = false;
}

async function showExp(id) {
  exp = await getExperiment(db, id);
  if (!exp) {
    $('notFound').hidden = false;
    return;
  }
  $('crumb').textContent = '飲み比べ';
  $('crumb').href = 'compare.html';
  await renderExp();
  if (queryParam('brewed') === '1') {
    const next = exp.entries.find((e) => !e.brewId);
    // 次に淹れる袋が見えるように
    (next ? $('brewCard') : $('tasteCard')).scrollIntoView({ block: 'start' });
  }
}

// ---- はじまり ----

async function init() {
  beans = (await listBeans(db)).filter((b) => b.deletedAt == null);
  const id = queryParam('id');
  if (id) await showExp(id);
  else await showList();
}

$('startForm').addEventListener('submit', (e) => {
  e.preventDefault(); // 処理中の2回目でも、ブラウザの送信は止める
  onStart(e);
});
$('reveal').addEventListener('click', onReveal);
$('remove').addEventListener('click', async () => {
  if (!confirm('この飲み比べをやめますか？淹れた抽出と評価は残ります')) return;
  await deleteExperiment(db, exp.id);
  location.replace('compare.html');
});

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込みに失敗しました', 'error');
});
