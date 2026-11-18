// 言葉の切れ目で折る（3-1.1）：純粋関数
// 日本語はブラウザがどの文字の間でも改行し、iPhoneのSafariには「文節で折る」指定（word-break: auto-phrase）がない。
// そこで文を「、」「・」「（ ）」「→」や空白の所で区切り、まとまりごとに途中で折らない箱（ui.js の phrased）に入れる。
// まとまりが1行より長いときは、箱の中で折れる（はみ出さない）。

/** 後ろで区切ってよい文字 */
const AFTER = new Set(['、', '。', '・', '：', '）', '」', '！', '？', '／', '，']);
/** 前で区切ってよい文字 */
const BEFORE = new Set(['（', '「']);
/** 短い見出しの言葉（「挽き目 24」の「挽き目」など）は、次の数字と離さない */
const SHORT_LABEL = 4;
const isSpace = (s) => /^\s+$/.test(s);
const isNumberish = (s) => /^[0-9０-９.:：±+\-−★℃g%]+/.test(s);

/**
 * 文をまとまりの並びにする。空白はまとまりにせず、そのまま1つの要素として残す（つなげると元の文に戻る）
 * @param {string} text
 * @returns {string[]}
 */
export function splitPhrases(text) {
  const s = String(text ?? '');
  if (!s) return [];
  // 1. 空白と区切りの文字で切る
  const raw = [];
  let cur = '';
  const flush = () => {
    if (cur) raw.push(cur);
    cur = '';
  };
  let depth = 0; // かっこの中は空白で区切らない（「（予想 ★3.8 ±0.9）」を1つに）
  for (const ch of s) {
    if (ch === '（' || ch === '(') depth += 1;
    if ((ch === '）' || ch === ')') && depth > 0) depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      flush();
      if (raw.length && isSpace(raw[raw.length - 1])) raw[raw.length - 1] += ch;
      else raw.push(ch);
      continue;
    }
    if (BEFORE.has(ch)) flush();
    cur += ch;
    if (AFTER.has(ch)) flush();
  }
  flush();

  // 2. 離さないものをつなぐ：「24 → 22」の矢印の両側、「挽き目 24」の短い見出しと数字
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const prevWord = out.length >= 2 && isSpace(out[out.length - 1]) ? out[out.length - 2] : null;
    if (t.startsWith('→') && prevWord != null) {
      // 前の言葉＋空白＋矢印（＋空白＋次の言葉）を1つに
      const sp = out.pop();
      let joined = out.pop() + sp + t;
      if (isSpace(raw[i + 1] ?? '') && raw[i + 2] != null && !isSpace(raw[i + 2])) {
        joined += raw[i + 1] + raw[i + 2];
        i += 2;
      }
      out.push(joined);
      continue;
    }
    if (!isSpace(t) && isNumberish(t) && prevWord != null && [...prevWord].length <= SHORT_LABEL && !/[、。・：）」]$/.test(prevWord)) {
      const sp = out.pop();
      out.push(out.pop() + sp + t);
      continue;
    }
    out.push(t);
  }
  return out;
}
