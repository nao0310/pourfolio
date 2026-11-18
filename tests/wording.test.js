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
