// レシピの一覧と「すぐ淹れる」（A1）
import { openDb, listRecipes, listBrews, getLastBrew, getRecipe, listBeans, setRecipeFavorite } from './db.js';
import { orderRecipesForList, recipeSummary, templateLabel, planFromBrew, formatSec } from './core/recipes.js';
import { cupsOf, perCupPlan } from './core/plan-adjust.js';
import { $, el, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const brewUrl = (recipeId) => `brew.html?recipe=${encodeURIComponent(recipeId)}`;

function favButton(recipe) {
  return el(
    'button',
    {
      type: 'button',
      class: `fav-btn${recipe.favorite ? ' on' : ''}`,
      'aria-pressed': recipe.favorite ? 'true' : 'false',
      'aria-label': recipe.favorite ? 'お気に入りから外す' : 'お気に入りにする',
      onclick: async () => {
        try {
          await setRecipeFavorite(db, recipe.id, !recipe.favorite);
          await render();
        } catch (err) {
          console.error(err);
          showMessage('保存できませんでした。もう一度押してください', 'error');
        }
      },
    },
    recipe.favorite ? '★' : '☆',
  );
}

function recipeCard(recipe) {
  const sub = [templateLabel(recipe.template), recipe.targetTotalSec ? `目標 ${formatSec(recipe.targetTotalSec)}` : '']
    .filter(Boolean)
    .join('　');
  return el(
    'div',
    { class: 'card recipe-card' },
    el('div', { class: 'bean-card-top' }, el('span', { class: 'bean-name' }, recipe.name), favButton(recipe)),
    el('div', { class: 'num-line' }, recipeSummary(recipe)),
    sub && el('div', { class: 'muted' }, sub),
    el(
      'div',
      { class: 'card-actions' },
      el('a', { class: 'btn', href: brewUrl(recipe.id) }, '淹れる'),
      el('a', { class: 'btn secondary', href: `recipe-edit.html?id=${encodeURIComponent(recipe.id)}` }, '編集する'),
      // タイマーを使わずに、淹れ終わってから記録して評価する（実績の確認をすぐ開く）
      el('a', { class: 'btn secondary', href: `${brewUrl(recipe.id)}&notimer=1` }, 'タイマーなしで記録'),
      el('a', { class: 'btn secondary', href: `share.html?recipe=${encodeURIComponent(recipe.id)}` }, '共有・印刷'),
    ),
  );
}

async function renderLast() {
  const last = await getLastBrew(db);
  if (!last) {
    $('last').replaceChildren();
    return;
  }
  const recipe = last.recipeId ? await getRecipe(db, last.recipeId) : null;
  const plan = perCupPlan(planFromBrew(last, recipe), cupsOf(last)); // 「前回と同じ」は1杯分から（2-8 の7番）
  const bean = (await listBeans(db)).find((b) => b.id === plan.beanId);
  $('last').replaceChildren(
    el(
      'div',
      { class: 'card last-card' },
      el('h2', {}, '前回と同じで淹れる'),
      el('div', {}, [recipe?.name ?? plan.name, bean?.name].filter(Boolean).join('　')),
      el('div', { class: 'num-line' }, recipeSummary(plan)),
      el('a', { class: 'btn block', href: 'brew.html?from=last' }, '前回と同じで淹れる'),
    ),
  );
}

async function render() {
  const [recipes, brews] = await Promise.all([listRecipes(db), listBrews(db)]);
  const ordered = orderRecipesForList(recipes, brews);
  // レシピがまだないときは「＋ レシピを作る」がこの画面でいちばん大事なボタン
  $('newRecipe').classList.toggle('secondary', ordered.length > 0);
  if (!ordered.length) {
    $('list').replaceChildren(
      el(
        'div',
        { class: 'card empty' },
        el('p', {}, 'まだレシピはありません。'),
        el('p', { class: 'muted' }, '下の「＋ レシピを作る」から、4:6メソッドや基本形の雛形で作れます。'),
      ),
    );
    return;
  }
  $('list').replaceChildren(el('h2', { class: 'section-title' }, 'レシピ'), ...ordered.map(recipeCard));
}

registerServiceWorker();
Promise.all([renderLast(), render()]).catch((err) => {
  console.error(err);
  $('list').replaceChildren(el('p', { class: 'error' }, 'レシピを読み込めませんでした。開き直してください'));
});
