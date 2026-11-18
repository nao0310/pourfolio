// 月次レポート（X4）：杯数・ベスト3・飲んだ産地・支出・好みの変化を A4 の1枚に（印刷・PDF 保存）
// ?month=YYYY-MM。分析と同じく ?demo=1 ならデモデータで見る（端末のデータには書かない）。
import { monthlyReport, reportMonths, monthLabel, isMonth, defaultReportMonth } from './core/monthly.js';
import { yen } from './core/cost.js';
import { formatYmdJa, localYmd } from './core/format.js';
import { loadAnalysisData, isDemo, analysisHref, setupAnalysisPage } from './analysis-data.js';
import { $, el, queryParam } from './ui.js';
import { registerServiceWorker } from './pwa.js';

let data = null;

function stat(label, value, note = '') {
  return el('div', { class: 'rp-stat' }, el('span', { class: 'rp-stat-label' }, label), el('span', { class: 'rp-stat-value num' }, value), note ? el('span', { class: 'rp-stat-note' }, note) : '');
}

function render(month) {
  const r = monthlyReport({ ...data, month });
  document.title = `${r.label}のレポート - Pourfolio`;
  const maxOrigin = Math.max(1, ...r.origins.map((o) => o.cups));
  $('sheet').replaceChildren(
    el('header', { class: 'rp-head' }, el('h2', {}, `${r.label}のコーヒー`), el('p', { class: 'muted' }, `Pourfolio${isDemo() ? '（デモ）' : ''}　${formatYmdJa(localYmd(), { withYear: true })} 作成`)),
    el(
      'div',
      { class: 'rp-stats' },
      stat('杯数', `${r.cups}杯`, `${r.days}日・${r.beansUsed}種類の豆`),
      stat('平均の★', r.avgStars != null ? `★${r.avgStars}` : '—', r.prevAvgStars != null ? `先月 ★${r.prevAvgStars}` : ''),
      stat('飲んだ額', `${yen(r.spend.drankJpy)}`, r.spend.uncostedCups ? `原価のない${r.spend.uncostedCups}杯を除く` : '飲んだ豆の原価'),
      stat('買った額', `${yen(r.spend.boughtJpy)}`, `${r.spend.bags}袋${r.spend.unpricedBags ? `（価格なし${r.spend.unpricedBags}袋）` : ''}・送料込み`),
    ),
    el('section', {}, el('h3', {}, 'ベスト3'), r.best.length ? el('ol', { class: 'rp-best' }, ...r.best.map((b) => el('li', {}, el('span', { class: 'num' }, `★${b.stars}`), `　${b.beanName}${b.roastLevel ? `（${b.roastLevel}）` : ''}`, el('span', { class: 'muted num' }, `　${formatYmdJa(b.ymd)}${b.ratio ? `・1:${b.ratio}` : ''}`)))) : el('p', { class: 'muted' }, '★を付けた杯がありません')),
    el(
      'section',
      {},
      el('h3', {}, '飲んだ産地'),
      r.origins.length
        ? el(
            'div',
            { class: 'rp-bars' },
            ...r.origins.map((o) => el('div', { class: 'rp-bar-row' }, el('span', { class: 'rp-bar-label' }, o.key), el('span', { class: 'rp-bar' }, el('span', { class: 'rp-bar-fill', style: `width:${Math.round((o.cups / maxOrigin) * 100)}%` })), el('span', { class: 'num' }, `${o.cups}杯`))),
            r.otherOrigins ? el('p', { class: 'muted' }, `ほか${r.otherOrigins}か国`) : '',
          )
        : el('p', { class: 'muted' }, 'この月の記録はありません。淹れると表示します'),
    ),
    el('section', {}, el('h3', {}, '好みの変化（先月と比べて）'), el('ul', { class: 'rp-list' }, ...r.prefChange.map((t) => el('li', {}, t)))),
    r.caffeinePerDayMg != null ? el('p', { class: 'muted' }, `飲んだ日のカフェインは平均 約${r.caffeinePerDayMg}mg（カフェインレスを除く目安）`) : '',
  );
}

async function init() {
  data = await loadAnalysisData();
  const months = reportMonths(data.brews, localYmd());
  const want = queryParam('month');
  const month = isMonth(want) ? want : defaultReportMonth(localYmd(), months, data.brews);
  if (!months.includes(month)) months.unshift(month);
  $('month').replaceChildren(...months.map((m) => el('option', { value: m }, monthLabel(m))));
  $('month').value = month;
  $('month').addEventListener('change', () => {
    history.replaceState(null, '', analysisHref('report.html', { month: $('month').value }));
    render($('month').value);
  });
  render(month);
}

$('printBtn').addEventListener('click', () => window.print());
setupAnalysisPage();
registerServiceWorker();
init().catch((err) => {
  console.error(err);
  $('sheet').replaceChildren(el('p', { class: 'error' }, '読み込めませんでした。開き直してください')); // 赤い文で（2-8の45番）
});
