// 理論カードと用語辞典（X25）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLOSSARY, GLOSSARY_GROUPS, glossaryByGroup, termById, termHref, findTerm } from '../js/core/glossary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('どの用語にも意味・説明・このアプリでの使われ方があり、id は重ならない', () => {
  const ids = new Set();
  const groups = new Set(GLOSSARY_GROUPS.map((g) => g.key));
  for (const t of GLOSSARY) {
    assert.match(t.id, /^[a-z0-9-]+$/, t.id);
    assert.ok(!ids.has(t.id), `id が重なっています：${t.id}`);
    ids.add(t.id);
    assert.ok(groups.has(t.group), `${t.id} の区分`);
    for (const k of ['word', 'short', 'detail', 'app']) assert.ok(String(t[k] ?? '').trim().length > 0, `${t.id} の ${k}`);
  }
  for (const t of GLOSSARY) for (const s of t.see ?? []) assert.ok(termById(s), `${t.id} の関連 ${s} がありません`);
  assert.equal(glossaryByGroup().reduce((n, g) => n + g.terms.length, 0), GLOSSARY.length);
});

test('spec 13.1 の用語集にある言葉が入っている', () => {
  for (const w of ['TDS', '抽出収率', '比率', '保持率', 'JAR', 'CATA', 'CVA', 'レスト', '蒸らし', '落ち切り', '微粉']) assert.ok(findTerm(w), w);
  assert.equal(findTerm('収率').id, 'ey');
  assert.equal(findTerm('ない言葉'), null);
  assert.equal(termHref('tds'), 'glossary.html#t-tds');
});

test('画面から開く「？」の行き先が、どれも辞典にある（書き漏れを見つける）', async () => {
  const used = new Set();
  const files = [
    ...(await readdir(ROOT)).filter((f) => f.endsWith('.html')),
    ...(await readdir(path.join(ROOT, 'js'))).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
  ];
  for (const f of files) {
    const s = await readFile(path.join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/glossary\.html#t-([a-z0-9-]+)/g)) used.add(m[1]);
    for (const m of s.matchAll(/termHelp\('([^']+)'\)/g)) used.add(m[1]);
    for (const m of s.matchAll(/withTerm\([^)]*?,\s*'([^']+)'\)/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 15, `「？」が少なすぎます（${used.size}）`);
  for (const id of used) assert.ok(termById(id), `辞典にない用語：${id}`);
  // 分析の新しい画面と、提案の根拠から開ける
  for (const id of ['repro', 'tds', 'ey', 'dialin', 'peak', 'cups-to-90']) assert.ok(used.has(id), id);
});

test('評価のあとの提案の「理論」から、直し方に合った理論カードを開く', async () => {
  const s = await readFile(path.join(ROOT, 'js/tasting-page.js'), 'utf8');
  const line = s.split('\n').find((l) => l.includes('const theoryTerm'));
  assert.ok(line, '理論カードの選び方');
  const ids = [...line.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).filter((id) => !['finer', 'coarser', 'water', 'dose'].includes(id));
  assert.deepEqual(ids, ['grind-time', 'ratio-theory', 'extraction-balance']);
  for (const id of ids) assert.ok(termById(id), id);
});
