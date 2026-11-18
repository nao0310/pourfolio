// 画面づくりの小さな共通部品（DOMを使うので js/core/ には置かない）
// 利用者の入力は必ず textContent で入れる（innerHTML は使わない）

export const $ = (id) => document.getElementById(id);

/**
 * 要素を作る。props の class は className、data は dataset、on〜 はイベント。
 * @param {string} tag
 * @param {object} [props]
 * @param {...(Node|string|null|undefined|false)} children
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'data') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

/** URLの ?id= の値 */
export const queryParam = (name) => new URLSearchParams(location.search).get(name);

/** 画面下のお知らせ欄に文を出す */
export function showMessage(text, kind = 'ok', id = 'msg') {
  const box = $(id);
  if (!box) return;
  box.textContent = text;
  box.className = kind;
}

/** 飲み頃の札（色＋文字。色だけに頼らない） */
export function freshnessPill(f) {
  if (!f) return el('span', { class: 'pill stage-none' }, '焙煎日なし');
  return el('span', { class: `pill stage-${f.stage}` }, f.label);
}
