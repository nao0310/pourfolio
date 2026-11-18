// 下の5つのタブ（spec 8章、D-063）：どの画面がどのタブに入るか（純粋関数）
// 入力の途中の画面（抽出・評価・登録や編集）にはタブを出さない。一本道で、下の保存ボタンと重ねないため（D-118）。

export const TABS = Object.freeze([
  { key: 'home', label: 'ホーム', href: './' },
  { key: 'brew', label: '淹れる', href: 'recipes.html' },
  { key: 'beans', label: '豆と在庫', href: 'beans.html' },
  { key: 'analysis', label: '分析', href: 'analysis.html' },
  { key: 'more', label: 'その他', href: 'more.html' },
]);

/** 画面のファイル名 → タブ。ここにない画面にはタブを出さない */
const PAGE_TAB = Object.freeze({
  'index.html': 'home',
  'today.html': 'home',
  'recipes.html': 'brew',
  'share.html': 'brew',
  'beans.html': 'beans',
  'bean.html': 'beans',
  'shopping.html': 'beans',
  'wishlist.html': 'beans',
  'shops.html': 'beans',
  'order-import.html': 'beans',
  'analysis.html': 'analysis',
  'dialin-history.html': 'analysis',
  'brew-chart.html': 'analysis',
  'factors.html': 'analysis',
  'profile.html': 'analysis',
  'calendar.html': 'analysis',
  'cost.html': 'analysis',
  'report.html': 'analysis',
  'life.html': 'analysis',
  'more.html': 'more',
  'equipment.html': 'more',
  'compare.html': 'more',
  'optimize.html': 'more',
  'data.html': 'more',
  'ai.html': 'more',
  'scan.html': 'more',
  'weather.html': 'more',
});

/** タブを出さない画面（入力の途中・開発用） */
export const NO_TAB_PAGES = Object.freeze(['brew.html', 'tasting.html', 'bean-edit.html', 'equipment-edit.html', 'recipe-edit.html', 'storage-test.html', 'recipe-card.html']);

/**
 * URLのパスから、その画面のタブ（タブを出さない画面は null）
 * @param {string} pathname location.pathname
 */
export function tabForPath(pathname) {
  const file = String(pathname ?? '').split('/').pop() || 'index.html';
  return PAGE_TAB[file] ?? null;
}

/** 表で決めている画面の一覧（テストで、全画面がどちらかに入っているかを確かめる） */
export const TAB_PAGES = Object.freeze(Object.keys(PAGE_TAB));

/** タブの小さな絵（線だけ。文字の名前も必ず付ける） */
export const TAB_ICONS = Object.freeze({
  home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z',
  brew: 'M5 6h14l-2 7a5 5 0 0 1-10 0zM9 20h6M12 18v2',
  beans: 'M12 3c4 0 6 4 6 9s-2 9-6 9-6-4-6-9 2-9 6-9zM12 4c-2 4 2 8 0 16',
  analysis: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
});

/** HTML に書き込むタブの部分の、始まりと終わりの印（npm run sw が書き込む。手で直さない） */
export const TABBAR_START = '<!-- tabbar：npm run sw が書き込む（手で直さない） -->';
export const TABBAR_END = '<!-- /tabbar -->';

/**
 * 下のタブの HTML（2-8 の3番）。画面の HTML に直接書いておき、画面が出た瞬間からタブが見えるようにする
 * （スクリプトであとから足すと、画面を移るたびにタブが一瞬消えて見えるため）
 * @param {string} current その画面のタブの key
 */
export function tabbarHtml(current) {
  const tabs = TABS.map((t) => {
    const cur = t.key === current;
    return `<a class="tab${cur ? ' current' : ''}" href="${t.href}"${cur ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" class="tab-icon" aria-hidden="true"><path d="${TAB_ICONS[t.key]}"></path></svg><span class="tab-label">${t.label}</span></a>`;
  });
  return `${TABBAR_START}\n  <nav class="tabbar" aria-label="メニュー">\n    ${tabs.join('\n    ')}\n  </nav>\n  ${TABBAR_END}`;
}

/**
 * 画面の HTML に、タブの部分を入れた（入れ直した）文字列を返す。タブを出さない画面はそのまま
 * 置き場所は </main> のすぐあと。すでにあれば中身だけ入れ替える
 * @param {string} file 画面のファイル名
 * @param {string} html
 */
export function withTabbar(file, html) {
  const key = PAGE_TAB[file];
  if (!key) return html;
  const block = tabbarHtml(key);
  const s = html.indexOf(TABBAR_START);
  if (s >= 0) {
    const e = html.indexOf(TABBAR_END, s);
    if (e < 0) throw new Error(`${file}：タブの終わりの印がありません`);
    return html.slice(0, s) + block + html.slice(e + TABBAR_END.length);
  }
  const m = html.indexOf('</main>');
  if (m < 0) throw new Error(`${file}：</main> がありません`);
  const at = m + '</main>'.length;
  return `${html.slice(0, at)}\n  ${block}${html.slice(at)}`;
}

/** 色の設定（ライト・ダーク）を CSS より先に伝える印。ダークで画面を移る瞬間に白く光らないように（2-8 の3番） */
export const COLOR_SCHEME_META = '<meta name="color-scheme" content="light dark">';

/** 画面の HTML に COLOR_SCHEME_META を入れた文字列を返す（charset の次の行。すでにあればそのまま） */
export function withColorScheme(html) {
  if (html.includes(COLOR_SCHEME_META)) return html;
  const m = html.match(/^([ \t]*)<meta charset="utf-8">\r?\n/m);
  if (!m) throw new Error('<meta charset="utf-8"> がありません');
  const at = m.index + m[0].length;
  return `${html.slice(0, at)}${m[1]}${COLOR_SCHEME_META}\n${html.slice(at)}`;
}
