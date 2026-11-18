// カレンダーとカフェイン（E8）：月のカレンダー（杯数の濃さ）と、直近30日のカフェインの目安の棒
import { loadAnalysisData, setupAnalysisPage, showLoadError } from './analysis-data.js';
import { analysisRows } from './core/analysis.js';
import { dailyStats, monthGrid, shiftMonth, lastDays, caffeineSummary } from './core/calendar.js';
import { localYmd, formatYmdJa } from './core/format.js';
import { plot, chartBox } from './chart.js';
import { $, el } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
let stats = new Map();
let shown = null;

function renderMonth() {
  const { year, month } = shown;
  const weeks = monthGrid(year, month, stats);
  const today = localYmd();
  const monthCups = weeks.flat().filter((d) => d.inMonth).reduce((a, d) => a + d.cups, 0);
  $('month').replaceChildren(
    el(
      'div',
      { class: 'month-nav' },
      el('button', { type: 'button', class: 'btn secondary small', onclick: () => move(-1), 'aria-label': '前の月' }, '‹ 前'),
      el('strong', {}, `${year}年${month}月（${monthCups}杯）`),
      el('button', { type: 'button', class: 'btn secondary small', onclick: () => move(1), 'aria-label': '次の月' }, '次 ›'),
    ),
    el(
      'table',
      { class: 'cal' },
      el('thead', {}, el('tr', {}, ...WEEK.map((w) => el('th', { scope: 'col' }, w)))),
      el(
        'tbody',
        {},
        ...weeks.map((w) =>
          el(
            'tr',
            {},
            ...w.map((d) =>
              el(
                'td',
                {
                  class: `cal-day lv-${d.level}${d.inMonth ? '' : ' out'}${d.ymd === today ? ' today' : ''}`,
                  title: d.cups ? `${formatYmdJa(d.ymd)} ${d.cups}杯・カフェイン約${d.caffeineMg}mg` : formatYmdJa(d.ymd),
                },
                el('span', { class: 'cal-date' }, String(d.day)),
                d.cups ? el('span', { class: 'cal-cups' }, `${d.cups}杯`) : '',
              ),
            ),
          ),
        ),
      ),
    ),
    el('p', { class: 'legend' }, ...[0, 1, 2, 3, 4].map((n) => el('span', { class: 'legend-item' }, el('span', { class: `swatch cal-day lv-${n}` }), n === 4 ? '4杯〜' : `${n}杯`))),
  );
}

function move(delta) {
  shown = shiftMonth(shown.year, shown.month, delta);
  renderMonth();
}

function renderCaffeine() {
  const days = lastDays(stats, localYmd(), 30);
  const s = caffeineSummary(days);
  const max = Math.max(200, ...days.map((d) => d.caffeineMg));
  const labels = Object.fromEntries(days.map((d, i) => [i + 1, formatYmdJa(d.ymd)]));
  const chart = plot({
    ariaLabel: '直近30日のカフェインの目安',
    height: 200,
    x: { min: 0.5, max: 30.5, ticks: 3, format: (n) => labels[n] ?? '', labels },
    y: { min: 0, max, label: 'mg', ticks: 4 },
    bars: days.map((d, i) => ({ x: i + 1, y: d.caffeineMg, title: `${formatYmdJa(d.ymd)} ${d.cups}杯・約${d.caffeineMg}mg` })),
    barWidth: 1,
  });
  $('caffeine').replaceChildren(
    el('h2', {}, 'カフェイン（直近30日）'),
    el(
      'dl',
      { class: 'plan-numbers' },
      el('dt', {}, '今日'),
      el('dd', { class: 'num' }, `約${s.todayMg}mg`),
      el('dt', {}, '飲んだ日の平均'),
      el('dd', { class: 'num' }, s.avgMg != null ? `約${s.avgMg}mg（${s.avgCups}杯）` : '—'),
      el('dt', {}, 'いちばん多い日'),
      el('dd', { class: 'num' }, s.maxDay ? `${formatYmdJa(s.maxDay.ymd)} 約${s.maxDay.caffeineMg}mg` : '—'),
    ),
    chartBox(chart, '棒は1日の合計です。抽出液を量っていない杯は「湯量−2×粉量」で見積もっています。'),
  );
}

async function render() {
  const data = await loadAnalysisData();
  stats = dailyStats(analysisRows(data));
  const [y, m] = localYmd().split('-').map(Number);
  shown = { year: y, month: m };
  $('content').replaceChildren(el('section', { class: 'card', id: 'month' }), el('section', { class: 'card', id: 'caffeine' }));
  renderMonth();
  renderCaffeine();
}

registerServiceWorker();
setupAnalysisPage();
render().catch((err) => showLoadError(err));
