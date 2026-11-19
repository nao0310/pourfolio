// 豆の登録・編集（C1）
import { openDb, addBean, updateBean, getBeanWithTx, listBeans, getWish, updateWish } from './db.js';
import { normalizeBeanInput, beanToFormValues, PROCESS_OPTIONS, VARIETY_OPTIONS, DEFAULT_SHOP } from './core/beans.js';
import { ROAST_LEVELS, initialStockG } from './core/roast.js';
import { formatG } from './core/format.js';
import { $, el, queryParam, showMessage } from './ui.js';
import { askConfirm } from './confirm-box.js';
import { parseProductText, productMemo } from './core/tonya.js';
import { wishToBeanForm } from './core/wishlist.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const form = $('form');
const editId = queryParam('id');
/** 気になる豆（F6）から「買った」で開いたとき、その気になる豆 */
let fromWish = null;
let allBeans = [];

// ---- 選択肢を作る ----
$('roastChips').replaceChildren(
  ...ROAST_LEVELS.map((lv) =>
    el('label', { class: 'chip' }, el('input', { type: 'radio', name: 'roastLevel', value: lv }), el('span', {}, lv)),
  ),
);
const fillSelect = (select, options) =>
  select.replaceChildren(
    el('option', { value: '' }, '（未入力）'),
    ...options.map((o) => el('option', { value: o }, o)),
    el('option', { value: 'その他' }, 'その他（入力する）'),
  );
fillSelect($('variety'), VARIETY_OPTIONS);
fillSelect($('process'), PROCESS_OPTIONS);

/** 「その他」を選んだときだけ自由入力欄を出す */
function syncOtherInputs() {
  for (const k of ['variety', 'process']) {
    const other = form.elements[`${k}Other`];
    other.hidden = form.elements[k].value !== 'その他';
  }
}

// ---- フォームの読み書き ----
function readForm() {
  const raw = {};
  for (const [k, v] of new FormData(form)) raw[k] = String(v);
  return raw;
}

function writeForm(values) {
  for (const [k, v] of Object.entries(values)) {
    const field = form.elements[k];
    if (!field) continue;
    if (field instanceof RadioNodeList) {
      for (const r of field) r.checked = r.value === v;
    } else if (field.type === 'checkbox') {
      field.checked = v === 'on';
    } else {
      field.value = v;
    }
  }
  syncOtherInputs();
}

function showErrors(errors) {
  for (const box of form.querySelectorAll('.field-error')) box.textContent = errors[box.dataset.for] ?? '';
  const first = Object.keys(errors)[0];
  if (!first) return;
  const target = form.elements[first];
  const node = target instanceof RadioNodeList ? target[0] : target;
  if (node?.closest('details')) node.closest('details').open = true;
  node?.focus?.({ preventScroll: true });
  node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

/** 在庫に入る量の見込みを表示する */
function updatePreview() {
  const { value } = normalizeBeanInput(readForm());
  const stock = initialStockG({ ...value, id: editId }, allBeans);
  const box = $('stockPreview');
  if (!stock) {
    box.textContent = '表記重量か実重量を入れると、在庫に入る量を表示します';
    box.className = 'stock-preview muted';
    return;
  }
  box.className = 'stock-preview';
  if (!stock.estimated) {
    box.textContent = `在庫に入る量：${formatG(stock.g)}`;
    return;
  }
  const how = stock.learned ? 'これまでの豆の実績' : `${value.roastLevel || '焙煎度不明'}の目安`;
  box.textContent = `在庫に入る量：約${formatG(stock.g)}（生豆時から${stock.lossPct}%減る見積もり。${how}）。届いたら実重量を量って入れると正確になります`;
}

// ---- 商品ページの文章から入れる（X28） ----
/** 商品ページの価格表（100g・200g…の値段）。価格を手で直すまでは、表記重量に合わせて価格を入れ直す */
let priceTable = [];
let autoPrice = false;

/** 選択肢にあればそのまま、なければ「その他」＋自由入力 */
const withOther = (k, v, options) => (options.includes(v) ? { [k]: v, [`${k}Other`]: '' } : { [k]: 'その他', [`${k}Other`]: v });

$('pasteRead').addEventListener('click', () => {
  const p = parseProductText($('pasteText').value);
  if (!p.found) {
    showMessage('銘柄や産地が見つかりませんでした。商品ページの文章を全部コピーしたか確かめてください', 'error', 'pasteMsg');
    return;
  }
  const values = { name: p.name, shop: DEFAULT_SHOP, productCode: p.productCode };
  const filled = ['銘柄'];
  const put = (k, v, label) => {
    if (!v) return;
    Object.assign(values, typeof v === 'object' ? v : { [k]: v });
    if (label) filled.push(label);
  };
  put('country', p.country, '産地');
  put('region', p.region, '地域');
  put('farm', p.farm, '農園');
  if (p.variety) put('variety', withOther('variety', p.variety, VARIETY_OPTIONS), '品種');
  if (p.process) put('process', withOther('process', p.process, PROCESS_OPTIONS), '精製');
  put('roastLevel', p.roastLevel, `焙煎度（店の標準の${p.roastLevel}）`);
  if (p.labelWeightG) {
    put('labelWeightG', String(p.labelWeightG), `表記重量（生豆時${p.labelWeightG}g）`);
    values.labelWeightBasis = 'green';
  }
  put('priceJpy', p.priceJpy != null ? String(p.priceJpy) : '', '価格');
  put('flavorNotes', p.flavorNotes, '店の風味説明');
  const memo = productMemo(p);
  if (memo && !form.elements.memo.value) put('memo', memo, 'メモ（規格など）');
  writeForm(values);
  priceTable = p.priceTable;
  autoPrice = p.priceJpy != null;
  if (filled.length > 4) $('more').open = true;
  const table = priceTable.length > 1 ? `価格は表記重量に合わせて入れ直します（${priceTable.map((r) => `${r.g}g ${r.priceJpy.toLocaleString('ja-JP')}円`).join('・')}）。` : '';
  showMessage(`入れた項目：${filled.join('・')}。焙煎度と重さは注文した内容に直してください。${table}`, 'ok', 'pasteMsg');
  $('pasteBox').open = false;
  updatePreview();
  form.elements.name.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

/** 気になる豆の中身を入れる（焙煎度はおすすめ、状態は入荷待ち） */
function fillFromWish(w, roast) {
  const f = wishToBeanForm(w, { roastLevel: ROAST_LEVELS.includes(roast) ? roast : '' });
  writeForm({
    ...f,
    ...(f.variety ? withOther('variety', f.variety, VARIETY_OPTIONS) : {}),
    ...(f.process ? withOther('process', f.process, PROCESS_OPTIONS) : {}),
  });
  priceTable = w.priceTable ?? [];
  autoPrice = priceTable.length > 0;
  $('back').textContent = '気になる豆';
  $('back').href = 'wishlist.html';
  $('pasteBox').hidden = true;
  $('wishMsg').hidden = false;
  showMessage(
    `気になる豆「${w.name}」の内容を入れました（状態は入荷待ち${f.roastLevel ? `、焙煎度は${f.roastLevel}` : ''}）。焙煎度・重さ・価格は注文した内容に直してから登録してください`,
    'ok',
    'wishMsg',
  );
}

form.addEventListener('input', (event) => {
  if (event.target.name === 'variety' || event.target.name === 'process') syncOtherInputs();
  if (event.target.name === 'priceJpy') autoPrice = false;
  if (event.target.name === 'labelWeightG' && autoPrice) {
    const g = Number(String(event.target.value).normalize('NFKC'));
    const hit = priceTable.find((r) => r.g === g);
    if (hit) form.elements.priceJpy.value = String(hit.priceJpy);
  }
  updatePreview();
});
form.addEventListener('change', updatePreview);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const { value, errors } = normalizeBeanInput(readForm());
  showErrors(errors);
  if (Object.keys(errors).length) {
    showMessage('入力を直してください', 'error');
    return;
  }
  // 購入済みの気になる豆から、もう一度登録しようとしたら確かめる（「戻る」で同じ豆が2件にならないように、総仕上げの55番）
  if (!editId && boughtBean) {
    if (!(await askConfirm(`この気になる豆は「${boughtBean.name}」として登録済みです。もう1袋登録しますか？`, { ok: '登録する' }))) return;
  }
  $('save').disabled = true;
  try {
    const saved = editId ? await updateBean(db, editId, value) : await addBean(db, value);
    // 気になる豆から登録したら、その気になる豆を「購入済み」にする（失敗しても豆の登録は済んでいる）
    if (!editId && fromWish) await updateWish(db, fromWish.id, { boughtBeanId: saved.id }).catch((err) => console.error(err));
    location.replace(`bean.html?id=${encodeURIComponent(saved.id)}`);
  } catch (err) {
    console.error(err);
    showMessage('保存できませんでした。もう一度押してください', 'error');
    $('save').disabled = false;
  }
});

let boughtBean = null;

async function init() {
  allBeans = await listBeans(db);
  if (editId) {
    const found = await getBeanWithTx(db, editId);
    if (!found) {
      $('title').textContent = '豆が見つかりません';
      form.hidden = true;
      form.after(el('p', { class: 'muted' }, '削除したのかもしれません。'), el('p', {}, el('a', { class: 'btn block', href: 'beans.html' }, '豆の一覧へ')));
      return;
    }
    document.title = '豆の編集 - Pourfolio';
    $('title').textContent = '豆の編集';
    $('save').textContent = '保存する';
    $('back').textContent = found.bean.name;
    $('back').href = `bean.html?id=${encodeURIComponent(editId)}`;
    writeForm(beanToFormValues(found.bean));
    // 入庫のほかに履歴がある豆は「入荷待ち」に戻せない。戻すと入庫が消えて残りがマイナスになるため（総仕上げの70番）
    if (found.txs.some((t) => t.deletedAt == null && t.kind !== 'in') && found.bean.status !== 'ordered') {
      const ordered = form.querySelector('input[name="status"][value="ordered"]');
      ordered.disabled = true;
      ordered.closest('label').title = '使った記録があるため選べません';
      ordered.closest('fieldset').append(el('span', { class: 'hint' }, '使った記録があるので「入荷待ち」には戻せません'));
    }
  } else {
    writeForm({ shop: DEFAULT_SHOP });
    const wishId = queryParam('wish');
    fromWish = wishId ? await getWish(db, wishId) : null;
    if (fromWish) fillFromWish(fromWish, queryParam('roast') ?? '');
    boughtBean = fromWish?.boughtBeanId ? allBeans.find((b) => b.id === fromWish.boughtBeanId && b.deletedAt == null) ?? null : null;
    if (boughtBean) {
      $('wishMsg').replaceChildren(
        `この気になる豆は「${boughtBean.name}」として登録済みです。`,
        el('a', { href: `bean.html?id=${encodeURIComponent(boughtBean.id)}` }, '登録した豆を見る'),
      );
      $('wishMsg').className = 'error';
    }
  }
  updatePreview();
}

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込めませんでした。開き直してください', 'error');
});
