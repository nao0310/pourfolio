// 下の5つのタブ（spec 8章、D-063）：どの画面がどのタブに入るか（純粋関数）
// 入力の途中の画面（抽出・評価・登録や編集）にはタブを出さない。一本道で、下の保存ボタンと重ねないため（D-118）。

export const TABS = Object.freeze([
  { key: 'home', label: 'ホーム', href: './' },
  { key: 'brew', label: '抽出', href: 'recipes.html' },
  { key: 'beans', label: '豆と在庫', href: 'beans.html' },
  { key: 'analysis', label: '分析', href: 'analysis.html' },
  { key: 'more', label: 'その他', href: 'more.html' },
]);

/** 画面のファイル名 → タブ。ここにない画面にはタブを出さない */
const PAGE_TAB = Object.freeze({
  'index.html': 'home',
  'today.html': 'home',
  'recipes.html': 'brew',
  'beans.html': 'beans',
  'bean.html': 'beans',
  'shopping.html': 'beans',
  'shops.html': 'beans',
  'order-import.html': 'beans',
  'analysis.html': 'analysis',
  'dialin-history.html': 'analysis',
  'brew-chart.html': 'analysis',
  'factors.html': 'analysis',
  'profile.html': 'analysis',
  'calendar.html': 'analysis',
  'cost.html': 'analysis',
  'more.html': 'more',
  'equipment.html': 'more',
  'compare.html': 'more',
  'data.html': 'more',
  'ai.html': 'more',
});

/** タブを出さない画面（入力の途中・開発用） */
export const NO_TAB_PAGES = Object.freeze(['brew.html', 'tasting.html', 'bean-edit.html', 'equipment-edit.html', 'recipe-edit.html', 'storage-test.html']);

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
