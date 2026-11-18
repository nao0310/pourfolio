// 抽出の画面（入口）：レシピか前回の抽出から計画を写して表示する（A1）
// タイマー（A2）・画面スリープ防止（A3）・実績の記録（A4）はステップ1-4で作る。
import { openDb, getRecipe, getLastBrew, listBeans, listEquipment } from './db.js';
import { planFromRecipe, planFromBrew, formatSec, POUR_STYLES } from './core/recipes.js';
import { sortBeansForList } from './core/beans.js';
import { formatG } from './core/format.js';
import { $, el, queryParam, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();

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

async function init() {
  const loaded = await loadPlan();
  if (!loaded) {
    $('notFound').hidden = false;
    return;
  }
  const { plan, recipe } = loaded;
  const [beans, equipment, last] = await Promise.all([listBeans(db), listEquipment(db), getLastBrew(db)]);
  const eqName = (id) => equipment.find((e) => e.id === id)?.name ?? '';

  $('content').hidden = false;
  $('name').textContent = plan.source === 'lastBrew' ? `前回と同じ：${recipe?.name ?? plan.name}` : plan.name;
  document.title = `${$('name').textContent} - Pourfolio`;
  $('sub').textContent = plan.source === 'lastBrew' ? '前回の抽出の計画を写しました' : `レシピ 版${plan.recipeVersion}`;
  if (plan.recipeId && recipe) $('editLink').href = `recipe-edit.html?id=${encodeURIComponent(plan.recipeId)}`;
  else $('editLink').hidden = true;

  // 豆：飲み切り以外。初期値は前回の豆（なければ一覧の先頭）
  const usable = sortBeansForList(beans).filter((b) => b.status !== 'finished');
  const preferred = plan.beanId ?? last?.beanId ?? null;
  const select = $('bean');
  select.replaceChildren(
    el('option', { value: '' }, usable.length ? '（選ばない）' : '（豆が未登録）'),
    ...usable.map((b) => el('option', { value: b.id }, [b.name, b.roastLevel].filter(Boolean).join('　'))),
  );
  select.value = usable.some((b) => b.id === preferred) ? preferred : usable[0]?.id ?? '';
  $('beanNote').textContent = preferred && select.value === preferred ? '前回の豆を選んでいます' : '';

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
        el('td', {}, i === 0 ? '蒸らし' : `${i + 1}`),
        el('td', { class: 'num' }, formatSec(p.atSec)),
        el('td', { class: 'num' }, formatG(p.toG)),
        el('td', {}, el('span', { class: 'num' }, `+${formatG(amount)}`), p.style ? el('span', { class: 'muted' }, ` ${POUR_STYLES[p.style] ?? ''}`) : ''),
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

$('start').addEventListener('click', () => {
  showMessage('ガイド付きタイマーは次のステップ（1-4）で作ります。今は計画の確認までです', 'ok');
});

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込みに失敗しました', 'error');
});
