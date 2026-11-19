// 文字のフォントの順（純粋な値）。同じ漢字でも中国語用のフォントで描くと字形が変わる（直・骨・角・写・今など）ため、
// system-ui より先に日本語のフォントを置く（総仕上げ、D-177）。
// css/base.css の body の font-family と、canvas の画像（js/brew-image.js）がこの順を使う。ずれは tests/fonts.test.js が見つける。
// iPhone・Mac：Hiragino Sans／Hiragino Kaku Gothic ProN、Windows：Yu Gothic UI／Yu Gothic／Meiryo、Android・Linux：Noto Sans CJK JP など。
export const JA_FONTS = Object.freeze([
  'Hiragino Sans',
  'Hiragino Kaku Gothic ProN',
  'Yu Gothic UI',
  'Yu Gothic',
  'YuGothic',
  'Meiryo',
  'Noto Sans JP',
  'Noto Sans CJK JP',
  'Source Han Sans JP',
]);

/** 最後に回す、OS の標準の書体 */
export const FALLBACK_FONTS = Object.freeze(['system-ui', '-apple-system', 'sans-serif']);

const quote = (f) => (/^[a-z-]+$/.test(f) ? f : `"${f}"`);

/** CSS の font-family に書く文字（例："Hiragino Sans", …, sans-serif） */
export const FONT_STACK = [...JA_FONTS, ...FALLBACK_FONTS].map(quote).join(', ');
