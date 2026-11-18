# vendor（同梱しているライブラリ）

CDNから読まず、ここに置いたファイルをそのまま使う（DECISIONS D-007）。更新するときは版と入手元をこの表に書く。

| ライブラリ | 版 | ファイル | 入手元 | ライセンス |
| --- | --- | --- | --- | --- |
| Dexie.js | 4.4.7 | `dexie/dexie.mjs`（npmパッケージの `dist/dexie.mjs` をそのまま） | npm `dexie@4.4.7` | Apache-2.0（`dexie/LICENSE`、`dexie/NOTICE`） |
| qrcode-generator | 2.0.4 | `qrcode-generator/qrcode.mjs`（npmパッケージの `dist/qrcode.mjs` をそのまま） | npm `qrcode-generator@2.0.4`（作者 Kazuhiko Arase） | MIT（`qrcode-generator/LICENSE`。パッケージにライセンスの文書がないため、ファイル冒頭の表記から書き起こした） |
| jsQR | 1.4.0 | `jsqr/jsQR.js`（npmパッケージの `dist/jsQR.js` をそのまま。UMD なので classic script で読み `self.jsQR` を使う） | npm `jsqr@1.4.0` | Apache-2.0（`jsqr/LICENSE`） |
