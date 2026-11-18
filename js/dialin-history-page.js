// ダイヤルインの道のり（E2）：豆を選ぶと、杯ごとの★の折れ線と、変えた条件・使った提案・雑味を並べる
// dialin-history.html?bean=<豆のID>
import { loadAnalysisData, setupAnalysisPage, analysisHref, showLoadError } from './analysis-data.js';
import { analysisRows, readinessText, THRESHOLDS } from './core/analysis.js';
import { beanJourneys, averageCupsTo90 } from './core/dialin-history.js';
import { starLevel } from './core/chart-scale.js';
import { formatYmdJa } from './core/format.js';
import { plot, chartBox, starLegend } from './chart.js';
import { $, el, queryParam, withTerm } from './ui.js';
import { registerServiceWorker } from './pwa.js';

let journeys = [];

function cupLine(c) {
  return el(
    'li',
    { class: 'journey-cup' },
    el(
      'div',
      { class: 'journey-head' },
      el('strong', { class: 'num' }, `${c.n}杯目`),
      el('span', { class: 'muted' }, formatYmdJa(c.ymd)),
      el('span', { class: `star-pill lv-${starLevel(c.stars)}` }, c.stars != null ? `★${c.stars}` : '★なし'),
    ),
    el('p', { class: 'small' }, c.n === 1 ? `はじめの1杯（挽き目 ${c.grind || '—'}・比率 1:${c.ratio ?? '—'}）` : c.changes.length ? `変えた：${c.changes.join('、')}` : '前の杯と同じ条件'),
    c.suggestion ? el('p', { class: 'small muted' }, `使った提案：${c.suggestion}`) : null,
    c.defects.length ? el('p', { class: 'small muted' }, `雑味：${c.defects.join('・')}`) : null,
  );
}

function renderJourney(j) {
  const box = $('journey');
  if (!j.ready.ready) {
    box.replaceChildren(el('p', { class: 'muted' }, readinessText(j.ready)), el('ol', { class: 'journey-list' }, ...j.cups.map(cupLine)));
    return;
  }
  const pts = j.cups.filter((c) => c.stars != null);
  const chart = plot({
    ariaLabel: `${j.bean.name}の杯ごとの★`,
    x: { min: 0.5, max: j.cups.length + 0.5, label: '何杯目', ticks: Math.min(10, j.cups.length), format: (n) => (Number.isInteger(n) ? String(n) : '') },
    y: { min: 0.5, max: 5.5, label: '★', ticks: 5, format: (n) => (Number.isInteger(n) ? String(n) : '') },
    lines: [{ cls: 'series', points: pts.map((c) => [c.n, c.stars]) }],
    points: pts.map((c) => ({ x: c.n, y: c.stars, level: starLevel(c.stars), title: `${c.n}杯目 ★${c.stars}${c.changes.length ? `（${c.changes.join('、')}）` : ''}` })),
  });
  box.replaceChildren(
    el(
      'dl',
      { class: 'plan-numbers' },
      el('dt', {}, '自己ベスト'),
      el('dd', { class: 'num' }, j.best != null ? `★${j.best}` : '—'),
      el('dt', {}, withTerm('ベストの9割まで', 'cups-to-90')),
      el('dd', { class: 'num' }, j.cupsTo90 != null ? `${j.cupsTo90}杯目` : '—'),
    ),
    chartBox(chart, starLegend()),
    el('ol', { class: 'journey-list' }, ...j.cups.map(cupLine)),
  );
}

function select(beanId, notice = null) {
  const j = journeys.find((x) => x.bean.id === beanId) ?? journeys[0];
  $('beanSelect').value = j.bean.id;
  $('missingNote').textContent = notice ?? '';
  $('missingNote').hidden = !notice;
  history.replaceState(null, '', analysisHref('dialin-history.html', { bean: j.bean.id }));
  renderJourney(j);
}

async function render() {
  const data = await loadAnalysisData();
  journeys = beanJourneys(analysisRows(data), data.suggestions);
  if (!journeys.length) {
    $('content').replaceChildren(el('p', { class: 'muted' }, `豆を選んで淹れると、ここに道のりが出ます（1つの豆で${THRESHOLDS.dialin}杯から）。`));
    return;
  }
  const avg = averageCupsTo90(journeys);
  $('content').replaceChildren(
    avg != null ? el('p', {}, `ダイヤルインの速さ：自己ベストの9割まで平均 ${avg}杯（3杯以上淹れた豆）`) : '',
    el(
      'label',
      { class: 'field' },
      el('span', { class: 'label' }, '豆'),
      el(
        'select',
        { id: 'beanSelect', onchange: (e) => select(e.target.value) },
        ...journeys.map((j) => el('option', { value: j.bean.id }, `${j.bean.name}（${j.cups.length}杯）`)),
      ),
    ),
    el('p', { class: 'muted', id: 'missingNote', role: 'status', hidden: true }),
    el('section', { class: 'card', id: 'journey' }),
  );
  // 指定した豆にまだ記録がないときは、黙って別の豆にせず知らせる（2-8 の19番）
  const asked = queryParam('bean');
  const askedName = asked && !journeys.some((j) => j.bean.id === asked) ? (data.beans ?? []).find((b) => b.id === asked && b.deletedAt == null)?.name : null;
  const notice = asked && !journeys.some((j) => j.bean.id === asked)
    ? `${askedName ? `「${askedName}」` : '指定された豆'}は、まだ道のりがありません（淹れて評価すると、ここに並びます）。いまは「${journeys[0].bean.name}」を出しています`
    : null;
  select(asked, notice);
}

registerServiceWorker();
setupAnalysisPage();
render().catch((err) => showLoadError(err));
