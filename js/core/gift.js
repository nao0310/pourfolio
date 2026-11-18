// おすそ分け記録（X34、純粋関数）
// おすそ分けは在庫履歴（kind: 'gift'）に、相手の名前（recipient）・メモ（memo）・あとから書く感想（feedback）を足して持つ。
// 相手の表は作らない（D-170）。3-5 より前のおすそ分け（相手なし）も一覧に出す。

import { parseNumber } from './beans.js';

const clean = (v) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const alive = (r) => r && r.deletedAt == null;

/** 名前・メモ・感想の長さの上限（文字） */
export const RECIPIENT_MAX = 30;
export const GIFT_MEMO_MAX = 200;
export const FEEDBACK_MAX = 400;
/** 1回に渡せる量の上限（g） */
export const GIFT_MAX_G = 5000;
/** 名前の候補の数 */
export const RECIPIENT_SUGGEST_MAX = 6;
/** 相手のないおすそ分けの名前 */
export const NO_RECIPIENT = '相手の記録なし';

/** 名前をまとめるときの鍵（全角・半角、空白、大文字・小文字の違いを無視） */
export function recipientKey(name) {
  return clean(name).replace(/\s+/g, '').toLowerCase();
}

/**
 * おすそ分けの入力を確かめる
 * @param {{g?:any, recipient?:any, memo?:any}} raw
 * @returns {{value:{g:number, recipient:string, memo:string}, errors:Record<string,string>}}
 */
export function normalizeGiftInput(raw = {}) {
  const errors = {};
  const n = parseNumber(raw.g);
  let g = null;
  if (n == null || Number.isNaN(n) || n <= 0 || n > GIFT_MAX_G) errors.g = '渡した量を0より大きい数字（g）で入れてください';
  else g = Math.round(n * 10) / 10;
  const recipient = clean(raw.recipient);
  if (recipient.length > RECIPIENT_MAX) errors.recipient = `名前は${RECIPIENT_MAX}文字までにしてください`;
  const memo = String(raw.memo ?? '').replace(/\s+/g, ' ').trim();
  if (memo.length > GIFT_MEMO_MAX) errors.memo = `メモは${GIFT_MEMO_MAX}文字までにしてください`;
  return { value: { g, recipient, memo }, errors };
}

/** 感想の入力を整える（空なら消す） */
export function normalizeFeedback(text) {
  const v = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  return v.length > FEEDBACK_MAX ? { value: null, error: `感想は${FEEDBACK_MAX}文字までにしてください` } : { value: v, error: '' };
}

/** 在庫履歴の中のおすそ分け（削除の印が付いたものは除く） */
export function giftTxs(txs) {
  return (txs ?? []).filter((t) => alive(t) && t.kind === 'gift');
}

/**
 * 名前の候補：前に渡した相手（回数の多い順 → 最近の順）。同じ人の書き方の違いはまとめて、最後に使った書き方を出す
 * @returns {string[]}
 */
export function recipientSuggestions(txs, max = RECIPIENT_SUGGEST_MAX) {
  const by = new Map();
  for (const t of giftTxs(txs)) {
    const name = clean(t.recipient);
    if (!name) continue;
    const k = recipientKey(name);
    const cur = by.get(k) ?? { name, n: 0, last: '' };
    cur.n += 1;
    if (String(t.at) >= cur.last) {
      cur.last = String(t.at);
      cur.name = name;
    }
    by.set(k, cur);
  }
  return [...by.values()]
    .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
    .slice(0, max)
    .map((x) => x.name);
}

/**
 * おすそ分けの一覧（新しい順）
 * @param {{txs:object[], beans:object[]}} p beans は削除した豆も含めて渡す（名前を出すため）
 * @returns {{tx:object, bean:object|null, beanName:string, recipient:string, g:number, at:string, memo:string, feedback:string}[]}
 */
export function giftRows({ txs = [], beans = [] }) {
  const byId = new Map((beans ?? []).map((b) => [b.id, b]));
  return giftTxs(txs)
    .map((tx) => {
      const bean = byId.get(tx.beanId) ?? null;
      return {
        tx,
        bean,
        beanName: clean(bean?.name) || '（消した豆）',
        beanAlive: alive(bean),
        recipient: clean(tx.recipient),
        g: Math.round(Math.abs(Number(tx.deltaG) || 0) * 10) / 10,
        at: String(tx.at ?? ''),
        memo: String(tx.memo ?? '').trim(),
        feedback: String(tx.feedback ?? '').trim(),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at) || String(b.tx.createdAt).localeCompare(String(a.tx.createdAt)));
}

/**
 * 相手ごとの合計（回数の多い順 → 最近の順）。相手のないものは最後に1行
 * @param {ReturnType<typeof giftRows>} rows
 * @returns {{name:string, none:boolean, count:number, totalG:number, lastAt:string, beans:string[], feedbacks:number}[]}
 */
export function giftTotals(rows) {
  const by = new Map();
  for (const r of rows ?? []) {
    const none = !r.recipient;
    const k = none ? '' : recipientKey(r.recipient);
    const cur = by.get(k) ?? { name: none ? NO_RECIPIENT : r.recipient, none, count: 0, totalG: 0, lastAt: '', beans: [], feedbacks: 0 };
    cur.count += 1;
    cur.totalG = Math.round((cur.totalG + r.g) * 10) / 10;
    if (r.at >= cur.lastAt) {
      cur.lastAt = r.at;
      if (!none) cur.name = r.recipient;
    }
    if (!cur.beans.includes(r.beanName)) cur.beans.push(r.beanName);
    if (r.feedback) cur.feedbacks += 1;
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => Number(a.none) - Number(b.none) || b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

/** 在庫の履歴の1行に添える文「→ 田中さん　メモ」 */
export function giftTxNote(tx) {
  const to = clean(tx?.recipient);
  const memo = String(tx?.memo ?? '').trim();
  return [to ? `→ ${to}` : '', memo].filter(Boolean).join('　');
}
