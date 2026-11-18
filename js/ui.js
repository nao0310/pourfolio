// 画面づくりの小さな共通部品（DOMを使うので js/core/ には置かない）
// 利用者の入力は必ず textContent で入れる（innerHTML は使わない）
import { splitPhrases } from './core/phrases.js';
import { termById, termHref } from './core/glossary.js';

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

/**
 * 文を言葉の切れ目で折れるようにした中身（まとまりは途中で折らない箱、空白はそのまま、3-1.1）
 * el() の子にそのまま渡せる。textContent は元の文と同じ
 * @param {string} text
 * @returns {(Node|string)[]}
 */
export function phrased(text) {
  return splitPhrases(text).map((t) => (/^\s+$/.test(t) ? t : el('span', { class: 'ph' }, t)));
}

/**
 * 画面に書いてある説明の文（文字だけの p・span・legend）を、言葉の切れ目で折れる文にする（3-1.1）
 * @param {ParentNode} root
 * @param {string} [selector]
 */
export function phraseStaticText(root = document, selector = 'p, .hint, .label, legend, h1, h2') {
  for (const node of root.querySelectorAll(selector)) {
    if (node.children.length || !node.textContent.trim()) continue; // 中に部品がある所・空の所（あとで中身を入れる）は触らない
    setPhrased(node, node.textContent);
  }
}

/** 箱の中身を、言葉の切れ目で折れる文にする */
export function setPhrased(node, text) {
  if (node) node.replaceChildren(...phrased(text));
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

let toastTimer = null;

/**
 * 画面の上に浮かべて出す短い知らせ（2-8の30番）。スクロールした位置に関係なく見える。
 * 4秒（失敗は8秒）で消える。押しても消える
 * @param {string} text
 * @param {'ok'|'error'|'muted'} [kind]
 */
export function showToast(text, kind = 'ok') {
  let box = document.getElementById('toast');
  if (!box) {
    box = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    box.addEventListener('click', () => box.classList.remove('show'));
    document.body.append(box);
  }
  box.textContent = text;
  box.dataset.kind = kind;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), kind === 'error' ? 8000 : 4000);
}

/**
 * 画面の読み込みに失敗したときの知らせ（2-8 の15番）。中身の箱が隠れたままでも見えるよう、main の先頭に出す。
 * 真っ白な画面のまま止まらないように
 */
export function showPageLoadError() {
  const main = document.querySelector('main');
  if (!main || main.querySelector('.load-error')) return;
  main.prepend(
    el(
      'div',
      { class: 'card load-error', role: 'alert' },
      el('p', {}, el('strong', {}, '画面を読み込めませんでした')),
      el('p', { class: 'muted' }, '開き直してください。何度も出るときは、トップに戻ってからもう一度開いてください。'),
      el('div', { class: 'row' }, el('a', { class: 'btn secondary', href: './' }, 'トップへ'), el('button', { class: 'btn secondary', type: 'button', onclick: () => location.reload() }, '開き直す')),
    ),
  );
}

/** 飲み頃の札（色＋文字。色だけに頼らない） */
export function freshnessPill(f) {
  if (!f) return el('span', { class: 'pill stage-none' }, '焙煎日なし');
  return el('span', { class: `pill stage-${f.stage}` }, f.label);
}

/** 冷凍中の札（常温が0で冷凍の袋だけ残っている豆。冷凍中は日数を数えない） */
export function frozenPill() {
  return el('span', { class: 'pill frozen' }, '冷凍中');
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

/** 画面に見えない入力欄に文章を入れて選び、コピーの命令を出す（クリップボードの機能が使えないブラウザ用） */
export function copyBySelection(text) {
  const box = el('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;' });
  box.value = text;
  document.body.append(box);
  box.focus();
  box.setSelectionRange(0, text.length); // iPhone の Safari は select() だけでは選ばれない
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  box.remove();
  return ok;
}

/** 文章をコピーする（クリップボード → 見えない入力欄の2段）。できたら true */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyBySelection(text);
  }
}

/** 自分で作った SVG の文字を要素にする（innerHTML を使わない） */
export function svgElement(svgText) {
  return document.importNode(new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement, true);
}

/**
 * 言葉の横の小さな「？」。押すと用語辞典のその項目を開く（X25）。押せる大きさは44px四方
 * @param {string} id js/core/glossary.js の用語の id
 */
export function termHelp(id) {
  const t = termById(id);
  if (!t) throw new Error(`用語がありません：${id}`);
  return el('a', { class: 'term-help', href: termHref(id), 'aria-label': `${t.word}とは（用語辞典）` }, el('span', { class: 'term-help-mark', 'aria-hidden': 'true' }, '?'));
}

/** 「TDS ？」のように、言葉と「？」を並べる */
export const withTerm = (text, id) => el('span', { class: 'term' }, text, termHelp(id));
