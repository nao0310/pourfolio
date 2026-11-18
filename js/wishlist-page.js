// 気になる豆（F6）：商品ページの貼り付けか手入力で足し、買ったら豆の登録画面を開く
import { openDb, readAll, addWish, updateWish, deleteWish } from './db.js';
import { normalizeWishInput, wishFormFromProduct, wishToFormValues, splitWishlist, wishSummary } from './core/wishlist.js';
import { nextBeanCandidates } from './core/next-bean.js';
import { parseProductText } from './core/tonya.js';
import { PROCESS_OPTIONS } from './core/beans.js';
import { ROAST_LEVELS } from './core/roast.js';
import { $, el, showMessage, showToast } from './ui.js';
import { askConfirm } from './confirm-box.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const form = $('form');
/** 直している気になる豆のID（足すときは null） */
let editId = null;
/** 商品ページの価格表（100g・200g…の値段） */
let priceTable = [];

$('processList').replaceChildren(...PROCESS_OPTIONS.map((p) => el('option', { value: p })));
$('roastLevel').replaceChildren(el('option', { value: '' }, '（わからない）'), ...ROAST_LEVELS.map((lv) => el('option', { value: lv }, lv)));

function readForm() {
  const raw = {};
  for (const [k, v] of new FormData(form)) raw[k] = String(v);
  return { ...raw, priceTable };
}

function writeForm(values) {
  for (const [k, v] of Object.entries(values)) {
    const field = form.elements[k];
    if (field && typeof v === 'string') field.value = v;
  }
}

function showErrors(errors) {
  for (const box of form.querySelectorAll('.field-error')) box.textContent = errors[box.dataset.for] ?? '';
  const first = Object.keys(errors)[0];
  if (first) form.elements[first]?.focus?.();
}

function resetForm() {
  form.reset();
  editId = null;
  priceTable = [];
  showErrors({});
  $('formTitle').textContent = '気になる豆を足す';
  $('save').textContent = '足す';
  $('cancelEdit').hidden = true;
}

$('pasteRead').addEventListener('click', () => {
  const p = parseProductText($('pasteText').value);
  if (!p.found) {
    showMessage('銘柄や産地が見つかりませんでした。商品ページの文章を全部コピーしたか確かめてください', 'error', 'pasteMsg');
    return;
  }
  const values = wishFormFromProduct(p, $('pasteUrl').value);
  writeForm(values);
  priceTable = values.priceTable;
  const filled = ['銘柄', p.country && '生産国', p.process && '精製', p.roastLevel && '焙煎度', p.priceJpy != null && '価格'].filter(Boolean);
  showMessage(`入れた項目：${filled.join('・')}。確かめて「${$('save').textContent}」を押してください`, 'ok', 'pasteMsg');
  $('pasteBox').open = false;
  form.elements.name.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const { value, errors } = normalizeWishInput(readForm());
  showErrors(errors);
  if (Object.keys(errors).length) {
    showMessage('入力を直してください', 'error');
    return;
  }
  $('save').disabled = true;
  try {
    if (editId) await updateWish(db, editId, value);
    else await addWish(db, value);
    showToast(editId ? `「${value.name}」を直しました` : `「${value.name}」を足しました`);
    resetForm();
    $('pasteText').value = '';
    $('pasteUrl').value = '';
    showMessage('', 'ok');
    await render();
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error');
  } finally {
    $('save').disabled = false;
  }
});

$('cancelEdit').addEventListener('click', () => {
  resetForm();
  showMessage('', 'ok');
});

function startEdit(w) {
  resetForm();
  editId = w.id;
  priceTable = w.priceTable ?? [];
  writeForm(wishToFormValues(w));
  $('formTitle').textContent = `「${w.name}」を直す`;
  $('save').textContent = '保存する';
  $('cancelEdit').hidden = false;
  form.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** 買ったときに開く豆の登録画面（おすすめの焙煎度を添える） */
function buyHref(w, cand) {
  const q = new URLSearchParams({ wish: w.id });
  if (cand?.roastLevel) q.set('roast', cand.roastLevel);
  return `bean-edit.html?${q}`;
}

function openRow(w, cand) {
  const facts = [wishSummary(w)];
  if (cand) facts.push(`予想★${cand.predicted}${cand.badge === 'explore' ? '・開拓' : ''}`);
  if (cand?.roastLevel) facts.push(`おすすめ：${cand.roastLevel}（${cand.roastWhy}）`);
  return el(
    'div',
    { class: 'wish-row' },
    el(
      'div',
      { class: 'shop-main' },
      el('span', { class: 'shop-name' }, w.name),
      ...facts.filter(Boolean).map((f) => el('span', { class: 'muted' }, f)),
      w.memo && el('span', { class: 'muted small' }, w.memo),
    ),
    el(
      'div',
      { class: 'row' },
      el('a', { class: 'btn small', href: buyHref(w, cand) }, '買った'),
      el('button', { class: 'btn secondary small', type: 'button', onclick: () => startEdit(w) }, '直す'),
      el(
        'button',
        {
          class: 'btn secondary small',
          type: 'button',
          onclick: async () => {
            if (!(await askConfirm(`「${w.name}」を気になる豆から消しますか？`, { ok: '消す', cancel: 'やめる', danger: true }))) return;
            await deleteWish(db, w.id);
            if (editId === w.id) resetForm();
            showToast(`「${w.name}」を消しました`);
            await render();
          },
        },
        '消す',
      ),
      w.productUrl && el('a', { class: 'link-more', href: w.productUrl, target: '_blank', rel: 'noopener noreferrer' }, '店のページ'),
    ),
  );
}

async function render() {
  const all = await readAll(db);
  const alive = (r) => r.deletedAt == null;
  const beans = all.beans.filter(alive);
  const { open, bought } = splitWishlist(all.wishlist, beans);
  const cands = nextBeanCandidates({ beans, brews: all.brews, tastings: all.tastings, experiments: all.experiments, wishlist: all.wishlist }, { max: Infinity });
  const candOf = new Map(cands.filter((c) => c.wishId).map((c) => [c.wishId, c]));
  $('openList').replaceChildren(
    ...(open.length
      ? open.map((w) => openRow(w, candOf.get(w.id)))
      : [el('p', { class: 'muted' }, 'まだありません。上の欄から足してください。')]),
  );
  $('boughtTitle').textContent = `購入済み（${bought.length}）`;
  $('boughtBox').hidden = bought.length === 0;
  $('boughtList').replaceChildren(
    ...bought.map(({ wish, bean }) =>
      el(
        'div',
        { class: 'shop-row' },
        el('span', { class: 'shop-main' }, el('span', { class: 'shop-name' }, wish.name), el('span', { class: 'muted' }, `豆「${bean.name}」として登録しました`)),
        el('a', { class: 'link-more', href: `bean.html?id=${encodeURIComponent(bean.id)}` }, '豆を見る'),
      ),
    ),
  );
}

registerServiceWorker();
render().catch((err) => {
  console.error(err);
  $('openList').textContent = '読み込めませんでした。開き直してください';
});
