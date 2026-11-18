// コスト（C6）：この1か月のまとめ、月の支出（買った額・飲んだ額）、銘柄・焙煎度・購入先ごとの1杯の単価と満足度
import { openDb, readAll } from './db.js';
import { monthlySpending, costByGroup, costSummary, yen, COST_GROUPS } from './core/cost.js';
import { localYmd } from './core/format.js';
import { $, el } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const db = openDb();
const GROUP_KEY = 'pourfolio.cost.groupBy';
let data = null;

const alive = (r) => r && r.deletedAt == null;

function readGroupBy() {
  try {
    const v = localStorage.getItem(GROUP_KEY);
    return Object.hasOwn(COST_GROUPS, v ?? '') ? v : 'name';
  } catch {
    return 'name';
  }
}

function renderSummary() {
  const s = costSummary({ ...data, today: localYmd() });
  const m = s.thisMonth;
  const rows = [
    ['1杯の平均', s.avgCost30 != null ? `${yen(s.avgCost30)}（直近30日の${s.costed30}杯）` : '価格のわかる杯がまだありません'],
    ['淹れた杯', `${s.cups30}杯（直近30日）`],
    ['今月買った', `${yen(m.boughtJpy)}${m.shippingJpy ? `（送料${yen(m.shippingJpy)}を含む）` : ''}`],
    ['今月飲んだ', yen(m.drankJpy)],
  ];
  $('summary').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

function renderMonths() {
  const rows = monthlySpending({ ...data, today: localYmd() });
  const max = Math.max(1, ...rows.map((r) => r.boughtJpy));
  $('months').replaceChildren(
    ...rows.map((r) => {
      const [y, m] = r.month.split('-').map(Number);
      const pct = Math.round((r.boughtJpy / max) * 100);
      return el(
        'div',
        { class: 'month-row' },
        el('span', { class: 'month-label' }, `${m}月`, m === 1 || r === rows[rows.length - 1] ? el('span', { class: 'muted small' }, ` ${y}`) : ''),
        el(
          'span',
          { class: 'month-bar-box', 'aria-label': `${m}月に買った額 ${yen(r.boughtJpy)}` },
          el('span', { class: 'month-bar', style: `width:${pct}%` }),
          el('span', { class: 'month-bar-text num' }, r.boughtJpy ? yen(r.boughtJpy) : '—'),
        ),
        el('span', { class: 'month-drank num' }, r.cups ? `飲 ${yen(r.drankJpy)}` : ''),
      );
    }),
  );
  const unpriced = rows.reduce((s, r) => s + r.unpricedBags, 0);
  const uncosted = rows.reduce((s, r) => s + r.uncostedCups, 0);
  const notes = [];
  if (unpriced) notes.push(`価格が未入力の豆が${unpriced}袋あり、買った額に入っていません`);
  if (uncosted) notes.push(`原価がわからない杯（豆を選んでいない・価格が未入力）が${uncosted}杯あり、飲んだ額に入っていません`);
  $('monthsNote').textContent = notes.join('。');
}

function renderGroups() {
  const by = document.querySelector('input[name="groupBy"]:checked')?.value ?? 'name';
  $('groupHead').textContent = COST_GROUPS[by];
  const rows = costByGroup({ ...data, by });
  if (!rows.length) {
    $('groups').replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, '豆を選んで淹れた記録がまだありません')));
    return;
  }
  $('groups').replaceChildren(
    ...rows.map((g) =>
      el(
        'tr',
        {},
        el('th', { scope: 'row' }, g.label),
        el('td', { class: 'num' }, String(g.cups)),
        el('td', { class: 'num' }, g.avgCostJpy != null ? yen(g.avgCostJpy) : '—'),
        el('td', { class: 'num' }, g.avgStars != null ? `★${g.avgStars}` : '—'),
        el('td', { class: 'num' }, g.yenPerStar != null ? yen(g.yenPerStar) : '—'),
      ),
    ),
  );
}

async function render() {
  const all = await readAll(db);
  data = { beans: all.beans.filter(alive), orders: all.orders.filter(alive), brews: all.brews.filter(alive), tastings: all.tastings };
  renderSummary();
  renderMonths();
  renderGroups();
}

const initial = readGroupBy();
for (const r of document.querySelectorAll('input[name="groupBy"]')) {
  r.checked = r.value === initial;
  r.addEventListener('change', () => {
    try {
      localStorage.setItem(GROUP_KEY, r.value);
    } catch {
      // 覚えられなくても表示は切り替える
    }
    renderGroups();
  });
}

registerServiceWorker();
render().catch((err) => {
  console.error(err);
  $('summary').replaceChildren(el('dt', { class: 'error' }, '読み込みに失敗しました'));
});
