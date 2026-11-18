// レシピカード（X2）とキャニスターのラベル（X14）：名刺か A6 の大きさで印刷する（PDF 保存はブラウザの印刷から）
// ?recipe=ID（&bean=ID）でレシピカード、?canister=豆ID でラベル。QR はレシピなら共有リンク、ラベルなら抽出の画面。
import { openDb, getRecipe, listBeans, listEquipment } from './db.js';
import { recipeCardText, canisterLabelText, CARD_SIZES } from './core/card-text.js';
import { sharePayload, encodeShare, shareUrl, QR_MAX_CHARS } from './core/share-code.js';
import { canisterUrl } from './core/scan-target.js';
import { qrSvg } from './core/qr-code.js';
import { $, el, queryParam, svgElement, showPageLoadError } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const appBase = new URL('./', location.href).href;
const SIZE_KEY = 'pourfolio.cardSize';
let size = 'card';
try {
  if (CARD_SIZES[localStorage.getItem(SIZE_KEY)]) size = localStorage.getItem(SIZE_KEY);
} catch {
  // 保存できない端末では毎回 名刺 から
}
let render = () => {};

function setSize(s) {
  size = s;
  try {
    localStorage.setItem(SIZE_KEY, s);
  } catch {
    // 覚えられなくても印刷はできる
  }
  const { w, h } = CARD_SIZES[s];
  $('pageSize').textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }`;
  $('sheet').style.setProperty('--card-w', `${w}mm`);
  $('sheet').style.setProperty('--card-h', `${h}mm`);
  $('sheet').className = `print-area size-${s}`;
  $('sizeSeg').replaceChildren(
    ...Object.entries(CARD_SIZES).map(([k, v]) =>
      el('button', { type: 'button', class: 'seg', 'aria-pressed': String(k === s), onclick: () => setSize(k) }, `${v.label}（${v.w}×${v.h}mm）`),
    ),
  );
  render();
}

const qrNode = (text, label) => (text && text.length <= QR_MAX_CHARS ? el('div', { class: 'pc-qr' }, svgElement(qrSvg(text, { label }))) : '');

async function initRecipe(id) {
  const [recipe, beans, equipment] = await Promise.all([getRecipe(db, id), listBeans(db), listEquipment(db)]);
  if (!recipe) return false;
  const bean = beans.find((b) => b.id === queryParam('bean')) ?? null;
  const nameOf = (eid) => equipment.find((e) => e.id === eid)?.name ?? '';
  const grinderName = nameOf(recipe.grind?.grinderId);
  const dripperName = nameOf(recipe.equipment?.dripperId);
  const link = shareUrl(appBase, await encodeShare(sharePayload({ recipe, bean, grinderName, dripperName })));
  $('title').textContent = 'レシピカード';
  $('back').href = `share.html?recipe=${encodeURIComponent(recipe.id)}${bean ? `&bean=${encodeURIComponent(bean.id)}` : ''}`;
  $('back').textContent = 'レシピの共有';
  document.title = `${recipe.name}のレシピカード - Pourfolio`;
  render = () => {
    const t = recipeCardText({ recipe, bean, grinderName, dripperName, size });
    $('sheet').replaceChildren(
      el(
        'article',
        { class: 'pc-card' },
        el(
          'div',
          { class: 'pc-head' },
          el('div', { class: 'pc-titles' }, el('p', { class: 'pc-title' }, t.title), t.bean ? el('p', { class: 'pc-sub' }, t.bean) : ''),
          qrNode(link, `${recipe.name}の共有QR`),
        ),
        el('p', { class: 'pc-summary num' }, t.summary),
        t.gear ? el('p', { class: 'pc-line' }, t.gear) : '',
        el('ol', { class: 'pc-pours num' }, ...t.pours.map((p) => el('li', {}, p))),
        el('p', { class: 'pc-line' }, [t.target, t.template].filter(Boolean).join('　')),
        t.memo ? el('p', { class: 'pc-memo' }, t.memo) : '',
        el('p', { class: 'pc-foot' }, 'Pourfolio　QRを読むと取り込めます'),
      ),
    );
  };
  return true;
}

async function initCanister(beanId) {
  const bean = (await listBeans(db)).find((b) => b.id === beanId);
  if (!bean) return false;
  $('title').textContent = 'キャニスターのラベル';
  $('back').href = `bean.html?id=${encodeURIComponent(bean.id)}`;
  $('back').textContent = bean.name;
  document.title = `${bean.name}のラベル - Pourfolio`;
  const url = canisterUrl(appBase, bean.id);
  render = () => {
    const t = canisterLabelText(bean);
    $('sheet').replaceChildren(
      el(
        'article',
        { class: 'pc-card pc-label' },
        el('div', { class: 'pc-head' }, el('div', { class: 'pc-titles' }, el('p', { class: 'pc-title' }, t.title), el('p', { class: 'pc-sub' }, t.sub), el('p', { class: 'pc-line' }, t.roast)), qrNode(url, `${bean.name}のキャニスター用QR`)),
        el('p', { class: 'pc-foot' }, t.howTo),
      ),
    );
  };
  return true;
}

async function init() {
  const canister = queryParam('canister');
  const ok = canister ? await initCanister(canister) : await initRecipe(queryParam('recipe') ?? '');
  if (!ok) {
    // どちらが見つからないかを書く（総仕上げの85番）
    $('notFoundText').textContent = canister ? '豆が見つかりません。削除したのかもしれません。' : 'レシピが見つかりません。削除したのかもしれません。';
    $('notFound').hidden = false;
    $('printBtn').disabled = true;
    return;
  }
  setSize(size);
}

$('printBtn').addEventListener('click', () => window.print());
registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showPageLoadError(); // 読み込みの失敗を「見つかりません」と言わない（総仕上げの74番）
});
