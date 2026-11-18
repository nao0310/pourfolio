// 抽出チャート（E3）：TDS×抽出収率の散布図に★を重ね、自分の好きゾーンと昔からの理想の範囲、比率の斜線を描く
import { loadAnalysisData, setupAnalysisPage, showLoadError } from './analysis-data.js';
import { analysisRows, readinessText } from './core/analysis.js';
import { chartPoints, favoriteZone, CLASSIC_ZONE, RATIO_LINES, ratioLineTds, zonePosition, GOOD_STARS } from './core/brew-chart.js';
import { starLevel } from './core/chart-scale.js';
import { formatYmdJa } from './core/format.js';
import { plot, chartBox, starLegend } from './chart.js';
import { $, el } from './ui.js';
import { registerServiceWorker } from './pwa.js';

async function render() {
  const data = await loadAnalysisData();
  const pts = chartPoints(analysisRows(data));
  if (!pts.length) {
    $('content').replaceChildren(
      el(
        'section',
        { class: 'card' },
        el('p', {}, 'まだTDS付きの杯がありません。'),
        el('p', { class: 'muted' }, '屈折計で測ったら、抽出の「実績の確認」か、評価の画面の「TDS（屈折計）」に入れてください。抽出収率は自動で計算します。'),
      ),
    );
    return;
  }
  const fz = favoriteZone(pts);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xmin = Math.min(16, ...xs) - 0.5;
  const xmax = Math.max(24, ...xs) + 0.5;
  const ymin = Math.min(1.0, ...ys) - 0.05;
  const ymax = Math.max(1.6, ...ys) + 0.05;
  // 比率の斜線。名前はグラフの中に収まる端に書く
  const lines = RATIO_LINES.map((r) => {
    const endX = Math.min(xmax, ymax * 0.97 * (r - 2));
    return { cls: 'ratio-line', points: [[xmin, ratioLineTds(r, xmin)], [endX, ratioLineTds(r, endX)]], label: `1:${r}`, free: true };
  });
  const rects = [{ ...CLASSIC_ZONE, cls: 'zone-classic' }];
  if (fz.zone) rects.push({ ...fz.zone, cls: 'zone-mine' });
  const chart = plot({
    ariaLabel: '抽出チャート：TDSと抽出収率の散布図',
    width: 340,
    height: 300,
    x: { min: xmin, max: xmax, label: '抽出収率（%）', ticks: 5 },
    y: { min: ymin, max: ymax, label: 'TDS（%）', ticks: 5 },
    rects,
    lines,
    points: pts.map((p) => ({
      x: p.x,
      y: p.y,
      level: starLevel(p.stars),
      hollow: p.estimated,
      title: `${formatYmdJa(p.ymd)} ${p.beanName} ★${p.stars ?? 'なし'} TDS ${p.y}%・収率 ${p.x}%${p.estimated ? '（抽出液は見積もり）' : ''}`,
    })),
  });
  const latest = pts[pts.length - 1];
  const zoneCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, '自分の好きゾーン'),
    fz.zone
      ? el('p', {}, `★${GOOD_STARS}以上の${fz.goodN}杯の真ん中：TDS ${fz.zone.y0}〜${fz.zone.y1}%、抽出収率 ${fz.zone.x0}〜${fz.zone.x1}%`)
      : el('p', { class: 'muted' }, fz.ready ? `★${GOOD_STARS}以上の杯が3杯たまると表示します（いま${fz.goodN}杯）` : readinessText(fz)),
    fz.zone ? el('p', {}, `直近の杯（${formatYmdJa(latest.ymd)}）は${zonePosition(latest, fz.zone)}`) : null,
    el('p', { class: 'muted small' }, '好きの範囲は人によって違い、主に濃さ（TDS）で分かれるという研究があります。昔からの理想は参考です。'),
  );
  $('content').replaceChildren(
    el(
      'section',
      { class: 'card' },
      chartBox(
        chart,
        starLegend(),
        el(
          'p',
          { class: 'legend' },
          fz.zone ? el('span', { class: 'legend-item' }, el('span', { class: 'swatch zone-mine' }), '自分の好きゾーン') : '',
          el('span', { class: 'legend-item' }, el('span', { class: 'swatch zone-classic' }), '昔からの理想（収率18〜22%・TDS 1.15〜1.35%）'),
        ),
        '中が白い点は、抽出液を量らず「湯量−2×粉量」（ドリッパーごとに量った杯があればその値）で見積もった杯。斜めの線は比率です。',
      ),
      el('p', { class: 'muted small' }, `TDS付き ${pts.length}杯`),
    ),
    zoneCard,
  );
}

registerServiceWorker();
setupAnalysisPage();
render().catch((err) => showLoadError(err));
