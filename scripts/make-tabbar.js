// 全画面の HTML に、下のタブと色の設定の印を書き込む（2-8 の3番）。npm run sw の中で動く。
// 書き込み忘れは npm test（tests/tabs.test.js）が見つける。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTabbar, withColorScheme } from '../js/core/tabs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let changed = 0;
for (const file of (await readdir(ROOT)).filter((f) => f.endsWith('.html'))) {
  const p = path.join(ROOT, file);
  const before = await readFile(p, 'utf8');
  const after = withColorScheme(withTabbar(file, before));
  if (after !== before) {
    await writeFile(p, after);
    changed++;
  }
}
console.log(changed ? `タブと色の設定を ${changed} 画面に書き込みました` : 'タブと色の設定は最新です');
