// sw.js に、端末に保存するファイルの一覧（指紋つき）を書き込む。
// アプリのファイル（html・css・js・icons・vendor・manifest）を変えたら実行する：npm run sw
// 作り直し忘れは npm test（tests/sw-manifest.test.js）が見つける。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAppFile, buildManifest, replaceManifestBlock, readManifestBlock } from '../js/core/offline.js';
import { APP_VERSION } from '../js/core/version.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** リポジトリの中のファイルを「/」区切りのパスで全部返す（隠しフォルダと node_modules は見ない） */
async function walk(dir, prefix = '') {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const rel = prefix + ent.name;
    if (ent.isDirectory()) out.push(...(await walk(path.join(dir, ent.name), `${rel}/`)));
    else out.push(rel);
  }
  return out;
}

/** 今のファイルから一覧を作る */
export async function currentManifest(root = ROOT) {
  const paths = (await walk(root)).filter(isAppFile);
  const files = await Promise.all(paths.map(async (p) => ({ path: p, bytes: await readFile(path.join(root, p)) })));
  return { label: APP_VERSION, ...(await buildManifest(files)) };
}

async function main() {
  const swPath = path.join(ROOT, 'sw.js');
  const src = await readFile(swPath, 'utf8');
  const manifest = await currentManifest();
  const before = readManifestBlock(src);
  if (before?.version === manifest.version && before?.label === manifest.label) {
    console.log(`sw.js の一覧は最新です（Ver ${manifest.label}、版 ${manifest.version}、${Object.keys(manifest.files).length}ファイル）`);
    return;
  }
  await writeFile(swPath, replaceManifestBlock(src, manifest));
  console.log(`sw.js の一覧を書き直しました（Ver ${manifest.label}、版 ${before?.version ?? 'なし'} → ${manifest.version}、${Object.keys(manifest.files).length}ファイル）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
