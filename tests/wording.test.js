// 2-8 総点検の24・25・33番：言葉のそろえ方（docs/debug/findings.md の「言葉のそろえ方」）が崩れていないか。
// アプリの画面（*.html）とスクリプト（js/）の文を調べる。昔の更新履歴（version.js）とコメントだけの行は除く。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
const files = [...readdirSync(root).filter((f) => f.endsWith('.html')), ...walk('js').filter((f) => f.endsWith('.js'))].filter(
  (f) => !/version\.js$/.test(f),
);

/** コメントの行（// と * で始まる行、<!-- -->）を除いた行 */
function codeLines(file) {
  return readFileSync(join(root, file), 'utf8')
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*\*|<!--)/.test(line))
    .map(({ line, n }) => ({ line: line.replace(/\/\/ .*$/, ''), n }));
}

function hits(re, { except = [] } = {}) {
  const out = [];
  for (const f of files) {
    if (except.some((e) => f.split(sep).join('/').endsWith(e))) continue;
    for (const { line, n } of codeLines(f)) if (re.test(line)) out.push(`${f}:${n}`);
  }
  return out;
}

test('失敗の文は「〜できませんでした。〜してください」の形（「〜に失敗しました」を使わない）', () => {
  assert.deepEqual(hits(/に失敗しました/, { except: ['js/pwa.js'] }), []); // pwa.js は開発者向けの console だけ
});

test('「今日の1杯」「飲んだ額」「買った額」にそろえる', () => {
  assert.deepEqual(hits(/今日の一杯/), []);
  assert.deepEqual(hits(/使った(金)?額/), []);
});

test('下のタブは「淹れる」、題も「淹れる」', () => {
  assert.deepEqual(hits(/tab-label">抽出</), []);
  assert.deepEqual(hits(/<title>抽出 - /), []);
});

test('確認は iPhone の標準の確認ではなく、アプリの中の箱（askConfirm）を使う（33番）', () => {
  assert.deepEqual(hits(/(^|[^.\w])confirm\(/, { except: ['js/confirm-box.js'] }), []);
});

test('ボタンは「保存する」「削除する」（「保存」「削除」だけにしない）', () => {
  assert.deepEqual(hits(/>(保存|削除)<\/button>/), []);
});

// ---- 総仕上げ（78〜91番）----

test('最初の画面は「ホーム」と呼ぶ（「トップ」を使わない、80番）', () => {
  assert.deepEqual(hits(/トップ/), []);
});

test('記録を消すボタンは「〜を削除する」「すべて削除する」（「〜を削除」「消す」「全部消す」で止めない、81番）', () => {
  assert.deepEqual(hits(/を削除<\/button>/), []);
  assert.deepEqual(hits(/全部消す|すべて消す|>全部消/), []);
  // 「消す」は入力欄を空にするときだけ。記録の削除の確認では使わない
  assert.deepEqual(hits(/(?<!取り)消しますか？/), []);
});

test('「保存」「登録」「編集」のボタンは「〜する」まで書く（82・83番）', () => {
  assert.deepEqual(hits(/[>']感想を保存[<']|[>']一言を保存[<']|入荷待ちとして登録[<']|＋ 豆を登録[<']|[>']編集[<']|[>']直す[<']|評価を直す/), []);
});

test('画面や操作の名前に「抽出」を使わない（「淹れる」。記録は「抽出の記録」、78番）', () => {
  assert.deepEqual(hits(/抽出の画面|で抽出へ|抽出を保存しました|抽出の「実績の確認」/), []);
});

test('空のときの文は「まだ○○はありません」（「まだ○○がありません」にしない、86番）', () => {
  assert.deepEqual(hits(/まだ[^。'"`]{1,20}がありません|がまだありません/), []);
});

test('確認の箱の「いいえ」は「いいえ」のまま（「やめる」にしない、91番）', () => {
  assert.deepEqual(hits(/cancel: 'やめる'/), []);
});
