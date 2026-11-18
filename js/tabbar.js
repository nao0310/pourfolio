// 下の5つのタブ（D-063・D-118）。全画面の HTML から読み込み、タブを出す画面だけに付ける。
// 抽出のタイマー中（body.timer-on）は CSS で隠す。
import { TABS, tabForPath } from './core/tabs.js';
import { el } from './ui.js';
import { svg } from './chart.js';

/** タブの小さな絵（線だけ。文字の名前も必ず付ける） */
const ICONS = {
  home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z',
  brew: 'M5 6h14l-2 7a5 5 0 0 1-10 0zM9 20h6M12 18v2',
  beans: 'M12 3c4 0 6 4 6 9s-2 9-6 9-6-4-6-9 2-9 6-9zM12 4c-2 4 2 8 0 16',
  analysis: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

function render() {
  const current = tabForPath(location.pathname);
  if (!current) return;
  const nav = el(
    'nav',
    { class: 'tabbar', 'aria-label': 'メニュー' },
    ...TABS.map((t) =>
      el(
        'a',
        { class: `tab${t.key === current ? ' current' : ''}`, href: t.href, 'aria-current': t.key === current ? 'page' : null },
        svg('svg', { viewBox: '0 0 24 24', class: 'tab-icon', 'aria-hidden': 'true' }, svg('path', { d: ICONS[t.key] })),
        el('span', { class: 'tab-label' }, t.label),
      ),
    ),
  );
  document.body.classList.add('has-tabbar');
  document.body.append(nav);
}

render();
