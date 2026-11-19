// レシピの共有（X10・X11）：送る側は QR とリンクを出し、受け取る側は中身を見てから取り込む
// 中身は URL の # のうしろだけに入り、サーバーには送られない（js/core/share-code.js）。
import { openDb, getRecipe, listBeans, listEquipment, addRecipe } from './db.js';
import { sharePayload, encodeShare, decodeShare, shareUrl, codeFromHash, recipeInputFromShare, beanLine, QR_MAX_CHARS } from './core/share-code.js';
import { qrSvg } from './core/qr-code.js';
import { recipeSummary, formatSec, POUR_STYLES } from './core/recipes.js';
import { sortBeansForList } from './core/beans.js';
import { $, el, queryParam, showMessage, copyText, svgElement } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const appBase = new URL('./', location.href).href;
let recipe = null;
let beans = [];
let equipment = [];
let link = '';

const nameOf = (id) => equipment.find((e) => e.id === id)?.name ?? '';

// ---- 送る ----

async function renderSend() {
  const bean = beans.find((b) => b.id === $('sBean').value) ?? null;
  const payload = sharePayload({ recipe, bean, grinderName: nameOf(recipe.grind?.grinderId), dripperName: nameOf(recipe.equipment?.dripperId) });
  link = shareUrl(appBase, await encodeShare(payload));
  $('link').value = link;
  if (link.length <= QR_MAX_CHARS) {
    $('qr').replaceChildren(svgElement(qrSvg(link, { label: `${recipe.name}のQRコード` })));
    $('qrNote').textContent = '';
  } else {
    $('qr').replaceChildren();
    $('qrNote').textContent = '中身が長すぎてQRにできません。豆の情報を外すか、リンクで送ってください';
  }
  const q = new URLSearchParams({ recipe: recipe.id });
  if (bean) q.set('bean', bean.id);
  $('cardLink').href = `recipe-card.html?${q.toString()}`;
}

async function initSend(id) {
  [recipe, beans, equipment] = await Promise.all([getRecipe(db, id), listBeans(db), listEquipment(db)]);
  if (!recipe) {
    $('emptyText').textContent = 'レシピが見つかりません。削除したのかもしれません。';
    $('empty').hidden = false;
    return;
  }
  $('send').hidden = false;
  $('sName').textContent = recipe.name;
  $('sSummary').textContent = recipeSummary(recipe);
  const list = sortBeansForList(beans).filter((b) => b.status !== 'finished' || b.id === queryParam('bean'));
  $('sBean').replaceChildren(el('option', { value: '' }, '（添えない）'), ...list.map((b) => el('option', { value: b.id }, [b.name, b.roastLevel].filter(Boolean).join('　'))));
  if (queryParam('bean')) $('sBean').value = queryParam('bean');
  $('sBean').addEventListener('change', () => renderSend());
  if (typeof navigator.share === 'function') {
    $('shareBtn').hidden = false;
    $('shareBtn').addEventListener('click', async () => {
      try {
        await navigator.share({ title: `レシピ「${recipe.name}」`, url: link });
      } catch (err) {
        // 閉じただけのときは何もしない。それ以外の失敗は知らせる（2-8の45番）
        if (err?.name !== 'AbortError') showMessage('共有できませんでした。「リンクをコピー」を使ってください', 'error', 'copyMsg');
      }
    });
  }
  $('copyBtn').addEventListener('click', async () => {
    if (await copyText(link)) showMessage('リンクをコピーしました。メッセージなどに貼り付けてください', 'ok', 'copyMsg');
    else {
      $('link').closest('details').open = true;
      $('link').focus();
      $('link').select();
      showMessage('自動でコピーできませんでした。リンクを長押しして「コピー」を押してください', 'error', 'copyMsg');
    }
  });
  await renderSend();
}

// ---- 受け取る ----

function renderReceive(payload) {
  const r = payload.recipe;
  $('rName').textContent = r.name || '共有されたレシピ';
  $('rSummary').textContent = [recipeSummary({ doseG: r.doseG, waterG: r.waterG, tempC: r.tempC }), r.targetTotalSec ? `落ち切り ${formatSec(r.targetTotalSec)}` : ''].filter(Boolean).join('・');
  $('rPours').replaceChildren(
    ...(r.pours ?? []).map((p, i) =>
      el('li', { class: 'num' }, `${formatSec(p.atSec)}　${i === 0 ? '蒸らし' : `${i + 1}投目`}　${p.toG}gまで${POUR_STYLES[p.style] ? `（${POUR_STYLES[p.style]}）` : ''}`),
    ),
  );
  const grind = [r.grinderName, r.grindSetting].filter(Boolean).join(' ');
  $('rGrind').textContent = [grind ? `挽き目：${grind}` : '', r.dripperName ? `ドリッパー：${r.dripperName}` : ''].filter(Boolean).join('　');
  $('rBean').textContent = payload.bean ? `豆：${beanLine(payload.bean)}` : '';
  if (/^https?:\/\//i.test(payload.bean?.productUrl ?? '')) {
    $('rProduct').hidden = false;
    $('rProductLink').href = payload.bean.productUrl;
  }
}

async function initReceive(code) {
  const res = await decodeShare(code);
  if (!res.ok) {
    $('emptyText').textContent = res.error;
    $('empty').hidden = false;
    return;
  }
  $('receive').hidden = false;
  renderReceive(res.payload);
  $('importBtn').addEventListener('click', async () => {
    const { value, errors } = recipeInputFromShare(res.payload);
    const first = Object.values(errors)[0];
    if (first) {
      showMessage(`取り込めませんでした：${first}`, 'error');
      return;
    }
    $('importBtn').disabled = true;
    try {
      const rec = await addRecipe(db, value);
      showMessage(`「${rec.name}」をレシピ帳に取り込みました`);
      $('rCard').hidden = true;
      $('after').hidden = false;
      $('brewLink').href = `brew.html?recipe=${encodeURIComponent(rec.id)}`;
      $('editLink').href = `recipe-edit.html?id=${encodeURIComponent(rec.id)}`;
      // 開き直して二重に取り込まないよう、# のうしろを消す
      history.replaceState(null, '', location.pathname);
    } catch (err) {
      console.error(err);
      $('importBtn').disabled = false;
      showMessage('取り込めませんでした。もう一度押してください', 'error');
    }
  });
}

async function init() {
  const code = codeFromHash(location.hash);
  if (code) return initReceive(code);
  const id = queryParam('recipe');
  if (id) return initSend(id);
  $('empty').hidden = false;
}

registerServiceWorker();
init().catch((err) => {
  console.error(err);
  showMessage('読み込めませんでした。開き直してください', 'error');
});
