// 漢字を日本語の字形で描くための決まり（総仕上げ、D-177）が崩れていないか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_STACK, JA_FONTS } from '../js/core/fonts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFile(path.join(ROOT, f), 'utf8');
const list = async (dir, ext) => (await readdir(path.join(ROOT, dir))).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));

test('全部のHTMLの <html> に lang="ja" がある', async () => {
  const files = await list('.', '.html');
  assert.ok(files.length > 30);
  for (const f of files) assert.match(await read(f), /<html[^>]*\slang="ja"[\s>]/, f);
  assert.equal(JSON.parse(await read('manifest.webmanifest')).lang, 'ja');
});

test('フォントの順：日本語のフォントが system-ui・sans-serif より先', () => {
  const names = FONT_STACK.split(',').map((s) => s.trim().replace(/"/g, ''));
  assert.equal(names[0], JA_FONTS[0]);
  const firstGeneric = names.findIndex((n) => ['system-ui', '-apple-system', 'sans-serif'].includes(n));
  for (const ja of ['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', 'Noto Sans CJK JP']) {
    const i = names.indexOf(ja);
    assert.ok(i >= 0 && i < firstGeneric, ja);
  }
  // 中国語用のフォントは入れない
  assert.ok(!names.some((n) => /\b(SC|TC|CN)\b|PingFang|YaHei|SimSun|SimHei/.test(n)));
});

test('CSS：body のフォントは js/core/fonts.js と同じ順。ほかの font-family は inherit だけ', async () => {
  for (const f of await list('css', '.css')) {
    const css = (await read(f)).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      if (v === 'inherit') continue;
      assert.equal(v, FONT_STACK, `${f} の font-family`);
    }
    // font: の書き方でフォントの名前を書かない（inherit だけ）
    for (const m of css.matchAll(/[{;\s]font\s*:\s*([^;}]+)/g)) assert.equal(m[1].trim(), 'inherit', `${f} の font:`);
  }
  const base = (await read('css/base.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(base, /body\s*\{[^}]*font-family:\s*"Hiragino Sans"/);
  // 入力欄・ボタン・SVGの文字にも引き継がせる
  assert.match(base, /button, input, select, textarea, optgroup \{ font-family: inherit; \}/);
  assert.match(base, /svg text \{ font-family: inherit; \}/);
});

test('HTML・JS の中にフォントの名前を直接書かない（js/core/fonts.js だけ）', async () => {
  const files = [...(await list('.', '.html')), ...(await list('js', '.js')), ...(await list('js/core', '.js'))];
  for (const f of files) {
    if (f.endsWith('fonts.js')) continue;
    const s = await read(f);
    assert.ok(!/font-family\s*:\s*(?!inherit)/.test(s), `${f} に font-family がある`);
    assert.ok(!/Hiragino|Meiryo|Yu Gothic|system-ui/.test(s), `${f} にフォントの名前がある`);
  }
});

test('canvas に文字を描くファイルは ctx.lang を日本語にし、フォントは js/core/fonts.js の順', async () => {
  const brew = await read('js/brew-image.js');
  assert.match(brew, /import \{ FONT_STACK \} from '\.\/core\/fonts\.js'/);
  assert.match(brew, /\$\{FONT_STACK\}/);
  assert.match(brew, /if \('lang' in ctx\) ctx\.lang = 'ja'/);
  for (const f of await list('js', '.js')) {
    const s = await read(f);
    if (!/fillText|strokeText/.test(s) && !/\btext\(ctx/.test(s)) continue;
    assert.match(s, /setJa\(cv\.getContext\('2d'\)\)/, `${f} で setJa を使っていない`);
  }
});

test('setJa：lang の使える canvas だけ ja にする', async () => {
  // brew-image.js は DOM を使わない部分だけ読み込める（canvas を作るのは呼んだときだけ）
  const { setJa } = await import('../js/brew-image.js');
  const withLang = { lang: 'inherit' };
  assert.equal(setJa(withLang).lang, 'ja');
  const without = {};
  assert.equal('lang' in setJa(without), false);
});
