// 再現性（E7）：豆の袋×レシピごとの★と濃さのブレ、8杯からの管理図、全体の再現性スコア
import { loadAnalysisData, setupAnalysisPage, showLoadError, isDemo } from './analysis-data.js';
import { analysisRows } from './core/analysis.js';
import { reproGroups, reproScore, reproLine, strengthLabel, strengthText, REPRO_MIN, REPRO_CHART } from './core/repro.js';
import { starLevel } from './core/chart-scale.js';
import { formatDateJa } from './core/format.js';
import { plot, chartBox } from './chart.js';
import { $, el, withTerm } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const r2 = (n) => Math.round(n * 100) / 100;

/** 管理図（杯の順の値、平均の線、±2σの線、レシピの版の変わり目） */
function controlChart(title, values, stats, { kind, versionChanges, rows }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v));
  const n = values.length;
  const isStars = kind === 'stars';
  const lo = isStars ? 0.5 : kind === 'jar' ? -2.5 : Math.min(...pts.map((p) => p.v), stats.chart.lower) - 0.05;
  const hi = isStars ? 5.5 : kind === 'jar' ? 2.5 : Math.max(...pts.map((p) => p.v), stats.chart.upper) + 0.05;
  const outside = new Set(stats.chart.outside);
  const lines = [
    { cls: 'center', points: [[0.5, stats.mean], [n + 0.5, stats.mean]] },
    { cls: 'limit', points: [[0.5, stats.chart.upper], [n + 0.5, stats.chart.upper]] },
    { cls: 'limit', points: [[0.5, stats.chart.lower], [n + 0.5, stats.chart.lower]] },
    ...versionChanges.map((i) => ({ cls: 'version-mark', free: true, points: [[i + 0.5, lo], [i + 0.5, hi]] })),
  ];
  const fmtV = (v) => (isStars ? `★${r2(v)}` : strengthText(kind, v));
  return chartBox(
    plot({
      ariaLabel: `${title}の管理図`,
      height: 190,
      x: { min: 0.5, max: n + 0.5, label: '杯（古い順）', ticks: Math.min(6, n) },
      y: isStars
        ? { min: lo, max: hi, ticks: 5, format: (v) => (Number.isInteger(v) ? `★${v}` : '') }
        : { min: lo, max: hi, ticks: 4, format: (v) => (kind === 'jar' ? String(v) : `${r2(v)}`) },
      lines,
      points: pts.map((p) => ({
        x: p.i + 1,
        y: p.v,
        level: isStars ? starLevel(p.v) : 0,
        hollow: outside.has(p.i),
        title: `${p.i + 1}杯目（${formatDateJa(rows[p.i].at)}） ${fmtV(p.v)}${outside.has(p.i) ? '・線の外' : ''}`,
      })),
      pointR: 4.5,
    }),
    `平均 ${fmtV(stats.mean)}、点線（赤）は平均±2σ（${fmtV(stats.chart.lower)}〜${fmtV(stats.chart.upper)}）${versionChanges.length ? '。縦の点線はレシピの版が変わった所' : ''}`,
    outside.size
      ? el('p', { class: 'small' }, `線の外：${[...outside].map((i) => `${i + 1}杯目（${formatDateJa(rows[i].at)}）`).join('、')}。その日のメモや条件を見返してみてください。`)
      : el('p', { class: 'muted small' }, 'どの杯も線の中に入っています。'),
  );
}

function groupCard(g) {
  const title = `${g.bean.name} × ${g.recipeName}`;
  const card = el(
    'section',
    { class: 'card' },
    el('h2', {}, title),
    el('p', { class: 'muted small' }, `${g.cups}杯（★あり ${g.stars.n}杯）・最後に淹れた日 ${formatDateJa(g.lastAt)}・信頼度 ${g.confidence.text}`),
  );
  const nums = [];
  if (g.stars.ready) nums.push(el('dt', {}, '★のブレ'), el('dd', {}, `±${r2(g.stars.sd)}（平均★${r2(g.stars.mean)}）`, ' ', el('span', { class: `repro-word ${g.stars.word.level}` }, g.stars.word.text)));
  if (g.strength.ready)
    nums.push(
      el('dt', {}, g.strength.kind === 'tds' ? withTerm('濃さ（TDS）', 'tds') : withTerm('濃さ（評価）', 'jar')),
      el('dd', {}, `±${r2(g.strength.sd)}${g.strength.kind === 'tds' ? '%' : '段階'}（${g.strength.n}杯）`, ' ', el('span', { class: `repro-word ${g.strength.word.level}` }, g.strength.word.text)),
    );
  if (nums.length) card.append(el('dl', { class: 'plan-numbers' }, ...nums));
  else card.append(el('p', {}, reproLine(g)));
  if (g.stars.chart) card.append(el('h3', { class: 'section-title' }, '★の管理図'), controlChart(`${title}の★`, g.rows.map((r) => r.stars), g.stars, { kind: 'stars', versionChanges: g.versionChanges, rows: g.rows }));
  else if (g.stars.ready) card.append(el('p', { class: 'muted small' }, `★のある杯が${REPRO_CHART}杯たまると管理図を出します（あと${REPRO_CHART - g.stars.n}杯）。`));
  if (g.strength.chart)
    card.append(
      el('h3', { class: 'section-title' }, `濃さ（${strengthLabel(g.strength.kind)}）の管理図`),
      controlChart(`${title}の濃さ`, g.strength.values, g.strength, { kind: g.strength.kind, versionChanges: g.versionChanges, rows: g.rows }),
    );
  if (!g.strength.ready && g.stars.ready)
    card.append(el('p', { class: 'muted small' }, `濃さのブレは、TDSか評価の「濃さ」を入れた杯が${REPRO_MIN}杯たまると出します（いま${g.strength.n}杯）。`));
  if (!isDemo()) card.append(el('p', {}, el('a', { href: `bean.html?id=${encodeURIComponent(g.bean.id)}` }, 'この豆の画面を開く')));
  return card;
}

async function render() {
  const data = await loadAnalysisData();
  const rows = analysisRows(data);
  const groups = reproGroups(rows, data.recipes);
  const score = reproScore(groups);
  const ready = groups.filter((g) => g.stars.ready || g.strength.ready);
  const waiting = groups.filter((g) => !(g.stars.ready || g.strength.ready));

  const head = el('section', { class: 'card' }, el('h2', {}, withTerm('再現性スコア', 'repro')));
  if (score.ready) {
    head.append(
      el('p', { class: 'repro-score' }, `${score.score}`, el('span', { class: 'muted small' }, ' / 100')),
      el('p', {}, `★のブレ ±${score.sd}（`, el('span', { class: `repro-word ${score.word.level}` }, score.word.text), `）。${REPRO_MIN}杯以上の組 ${score.groups}つ・${score.cups}杯から`),
      el('p', { class: 'muted small' }, 'ブレ0で100、★1つ分のブレで50、★2つ分で0です。', withTerm('標準偏差', 'sd')),
    );
  } else {
    head.append(el('p', {}, `同じ豆の袋を同じレシピで${REPRO_MIN}杯淹れて★を付けると、ブレを出します。`));
  }
  head.append(el('p', { class: 'muted small' }, 'アイスの杯と、杯数を変えて淹れた杯は数えません。レシピの版が変わっても同じレシピとして数えます。'));

  const waitCard = waiting.length
    ? el(
        'section',
        { class: 'card' },
        el('h2', {}, 'もう少しで出る組'),
        el('ul', { class: 'plain-list' }, ...waiting.slice(0, 12).map((g) => el('li', {}, `${g.bean.name} × ${g.recipeName}：${reproLine(g)}`))),
        waiting.length > 12 ? el('p', { class: 'muted small' }, `ほか${waiting.length - 12}組`) : null,
      )
    : null;

  $('content').replaceChildren(
    head,
    ...(ready.length ? ready.map(groupCard) : [el('section', { class: 'card' }, el('p', { class: 'muted' }, groups.length ? 'まだブレを出せる組はありません。' : 'まだ記録はありません。レシピを選んで淹れて、★を付けると表示します。'))]),
    waitCard ?? '',
  );
}

registerServiceWorker();
setupAnalysisPage();
render().catch((err) => showLoadError(err));
