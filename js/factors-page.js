// 条件と評価（E4）：挽き目・湯温・比率・焙煎後日数と★の散布図・傾向線、焙煎度ごとの飲み頃カーブ
import { loadAnalysisData, setupAnalysisPage, showLoadError } from './analysis-data.js';
import { analysisRows, readinessText } from './core/analysis.js';
import { factorAnalysis, roastCurves } from './core/factors.js';
import { starLevel } from './core/chart-scale.js';
import { plot, chartBox } from './chart.js';
import { $, el, termHelp, withTerm } from './ui.js';
import { registerServiceWorker } from './pwa.js';

function factorCard(f, grinderName) {
  const head = el('h2', {}, f.label);
  if (!f.points.length) return el('section', { class: 'card' }, head, el('p', { class: 'muted' }, 'まだ記録はありません。豆を登録して、淹れて評価すると表示します'));
  const xs = f.points.map((p) => p.x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const pad = lo === hi ? 1 : (hi - lo) * 0.08;
  const lines = f.fit ? [{ cls: 'trend', points: [lo, hi].map((x) => [x, f.fit.intercept + f.fit.slope * x]) }] : [];
  // 同じ値の点が重なるので、少し縦横にずらす（並びは決まった順）
  const jitter = (i) => ((i % 5) - 2) * (pad / 5);
  const jitterY = (i) => ((Math.floor(i / 5) % 5) - 2) * 0.07;
  const chart = plot({
    ariaLabel: `${f.label}と★の散布図`,
    height: 200,
    x: { min: lo - pad, max: hi + pad, label: `${f.label}${f.unit ? `（${f.unit}）` : ''}`, ticks: 5 },
    y: { min: 0.5, max: 5.5, ticks: 5, format: (n) => (Number.isInteger(n) ? `★${n}` : '') },
    lines,
    points: f.points.map((p, i) => ({ x: p.x + jitter(i), y: p.y + jitterY(i), level: starLevel(p.y), title: `${f.label} ${p.x}${f.unit} ★${p.y}` })),
    pointR: 4,
  });
  return el(
    'section',
    { class: 'card' },
    head,
    el('p', { class: `factor-word ${f.word.level}` }, f.word.text, f.fit ? el('span', { class: 'muted small' }, `（相関 ${f.fit.r.toFixed(2)}・${f.n}杯）`, termHelp('correlation')) : ''),
    chartBox(chart, [f.hint, f.key === 'grind' && grinderName ? `${grinderName}の杯だけ（目盛りはグラインダーごとに違うため）` : ''].filter(Boolean).join('。')),
  );
}

function curveCard(curves) {
  const card = el('section', { class: 'card' }, el('h2', {}, withTerm('飲み頃カーブ（焙煎度ごと）', 'peak')), el('p', { class: 'muted' }, '焙煎後の日数ごとの★の平均です。同じ焙煎度で5袋たまると線を出します。'));
  if (!curves.length) {
    card.append(el('p', { class: 'muted' }, '焙煎日のある豆で淹れて★を付けると、ここに出ます'));
    return card;
  }
  for (const c of curves) {
    card.append(el('h3', { class: 'section-title' }, `${c.level}（${c.bags}袋・${c.cups}杯）`));
    if (!c.ready.ready) {
      card.append(el('p', { class: 'muted' }, readinessText(c.ready, '袋')));
      continue;
    }
    const pts = c.bins.filter((b) => b.mean != null);
    const labels = Object.fromEntries(c.bins.map((b) => [b.mid, b.label.replace('日', '')]));
    card.append(
      chartBox(
        plot({
          ariaLabel: `${c.level}の焙煎後日数と★`,
          height: 190,
          x: { min: 0, max: 36, label: '焙煎後日数', ticks: 6 },
          y: { min: 0.5, max: 5.5, ticks: 5, format: (n) => (Number.isInteger(n) ? `★${n}` : '') },
          lines: [{ cls: 'series', points: pts.map((b) => [b.mid, b.mean]) }],
          points: pts.map((b) => ({ x: b.mid, y: b.mean, level: starLevel(b.mean), title: `${labels[b.mid] ?? b.label}日 ★${b.mean}（${b.n}杯）` })),
        }),
        c.peak ? `いちばん★が高いのは ${c.peak.label}（平均★${c.peak.mean}・${c.peak.n}杯）` : '2杯以上の区切りはまだありません',
      ),
    );
  }
  return card;
}

async function render() {
  const data = await loadAnalysisData();
  const rows = analysisRows(data);
  const fa = factorAnalysis(rows);
  const curves = roastCurves(rows);
  if (!fa.ready.ready) {
    $('content').replaceChildren(el('section', { class: 'card' }, el('p', {}, readinessText(fa.ready)), el('p', { class: 'muted' }, '★を付けた杯が20杯たまると、条件ごとの傾向を出します。')), curveCard(curves));
    return;
  }
  const grinderName = data.equipment.find((e) => e.id === fa.grinderId)?.name ?? '';
  $('content').replaceChildren(
    fa.strongest
      ? el(
          'section',
          { class: 'card' },
          el('h2', {}, 'いちばん一緒に動いている条件'),
          el('p', {}, `${fa.strongest.label}：${fa.strongest.word.text}`),
          // 一緒に動いているだけかもしれないので、1つだけ変えた飲み比べで確かめる（spec 5.3、F7）
          el('div', { class: 'row' }, el('a', { class: 'btn secondary', href: 'compare.html#ideasCard' }, '飲み比べで確かめる')),
        )
      : el('section', { class: 'card' }, el('p', {}, 'どの条件も、★とはっきり一緒に動いてはいません。')),
    ...fa.factors.map((f) => factorCard(f, grinderName)),
    curveCard(curves),
  );
}

registerServiceWorker();
setupAnalysisPage();
render().catch((err) => showLoadError(err));
