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

/**
 * ±ボタン付きの数字の入力欄。数字はほぼ打たずに±で直せるようにする（spec 8.2）。
 * @param {{id:string, label:string, unit?:string, step:number, decimals?:number, min?:number, max?:number,
 *          hint?:string, errorFor?:string, onValue:(n:number|null, raw:string)=>void}} opts
 * @returns {{node:HTMLElement, input:HTMLInputElement, set:(v:number|string|null)=>void, setStep:(n:number)=>void}}
 */
export function stepperField(opts) {
  const { id, label, unit = '', decimals = 0, min = -Infinity, max = Infinity, hint, errorFor, onValue } = opts;
  let step = opts.step;
  const input = el('input', { type: 'text', id, inputmode: decimals ? 'decimal' : 'numeric', autocomplete: 'off' });
  const fmt = (n) => String(Number(n.toFixed(decimals)));
  const read = () => {
    const s = input.value.normalize('NFKC').trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };
  const bump = (dir) => {
    const cur = read();
    if (cur == null || Number.isNaN(cur)) return;
    const next = Math.min(max, Math.max(min, Math.round((cur + dir * step) * 10 ** decimals) / 10 ** decimals));
    input.value = fmt(next);
    onValue(next, input.value);
  };
  input.addEventListener('input', () => onValue(read(), input.value));
  const btn = (dir, text, name) => el('button', { type: 'button', class: 'step-btn', 'aria-label': `${label}を${name}`, onclick: () => bump(dir) }, text);
  const node = el(
    'div',
    {},
    el('label', { class: 'label', for: id }, label),
    el('div', { class: 'stepper' }, btn(-1, '−', '減らす'), el('span', { class: 'with-unit' }, input, unit && el('span', {}, unit)), btn(1, '＋', '増やす')),
    hint && el('span', { class: 'hint' }, hint),
    errorFor && el('span', { class: 'field-error', data: { for: errorFor } }),
  );
  return {
    node,
    input,
    set(v) {
      if (document.activeElement === input) return; // 入力中の欄は書き換えない
      input.value = v == null || v === '' ? '' : typeof v === 'number' ? fmt(v) : String(v);
    },
    setStep(n) {
      step = n;
    },
  };
}
