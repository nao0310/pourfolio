// エイジング日誌（X31）：豆ごとの焙煎後日数と★、飲み頃の山、杯ごとの記録（?bean=ID でその豆だけ）
import { loadAnalysisData, setupAnalysisPage, showLoadError, isDemo, analysisHref } from './analysis-data.js';
import { analysisRows } from './core/analysis.js';
import { agingAll, AGING_MIN } from './core/aging.js';
import { starLevel } from './core/chart-scale.js';
import { formatDateJa } from './core/format.js';
import { plot, chartBox, starLegend } from './chart.js';
import { $, el, queryParam, withTerm } from './ui.js';
import { registerServiceWorker } from './pwa.js';

function agingChart(a) {
  const maxDay = Math.max(30, ...a.entries.map((e) => e.days));
  const xmax = Math.min(60, maxDay + 2);
  const rated = a.entries.filter((e) => e.stars != null && e.days <= xmax);
  const bins = a.bins.filter((b) => b.mean != null && b.mid <= xmax);
  // 同じ日の点が重なるので少し縦にずらす
  const seen = new Map();
  const points = rated.map((e) => {
    const k = `${e.days}|${e.stars}`;
    const c = seen.get(k) ?? 0;
    seen.set(k, c + 1);
    return { x: e.days, y: e.stars + ((c % 3) - 1) * 0.08 * Math.min(c, 1), level: starLevel(e.stars), hollow: e.iced, title: `${e.days}日目（${formatDateJa(e.at)}） ★${e.stars}${e.iced ? '・アイス' : ''}${e.frozen ? '・冷凍の袋' : ''}` };
  });
  const rects = [{ x0: a.standard.from - 0.5, x1: a.standard.to + 0.5, y0: 0.5, y1: 5.5, cls: 'std-window', label: '目安' }];
  if (a.peak) rects.push({ x0: a.peak.from - 0.5, x1: Math.min(xmax, Number.isFinite(a.peak.to) ? a.peak.to + 0.5 : xmax), y0: 0.5, y1: 5.5, cls: 'peak', label: '山' });
  return chartBox(
    plot({
      ariaLabel: `${a.bean.name}の焙煎後日数と★`,
      height: 200,
      x: { min: 0, max: xmax, label: '焙煎後日数', ticks: 6 },
      y: { min: 0.5, max: 5.5, ticks: 5, format: (n) => (Number.isInteger(n) ? `★${n}` : '') },
      rects,
      lines: bins.length >= 2 ? [{ cls: 'series', points: bins.map((b) => [b.mid, b.mean]) }] : [],
      points,
      pointR: 4.5,
    }),
    '点は1杯ずつ（白抜きはアイス）、線は日数の区切りごとの★の平均。点線の枠は焙煎度の目安、色の帯は飲み頃の山です。',
  );
}

function entryItem(e) {
  const head = [`${e.days}日目`, formatDateJa(e.at), e.stars != null ? `★${e.stars}` : '★なし'];
  if (e.iced) head.push('アイス');
  if (e.frozen) head.push('冷凍の袋');
  const words = [...e.tags, ...e.jar];
  return el(
    'li',
    {},
    el('p', {}, el('span', { class: 'aging-days' }, head[0]), ' ', head.slice(1).join('・')),
    words.length ? el('p', { class: 'small' }, words.join('、')) : null,
    e.memo ? el('p', { class: 'muted small' }, e.memo) : null,
  );
}

function beanCard(a, open) {
  const card = el(
    'section',
    { class: 'card' },
    el('h2', {}, a.bean.name || '（銘柄なし）'),
    el('p', { class: 'muted small' }, [a.bean.roastLevel, a.bean.roastDate ? `焙煎日 ${formatDateJa(a.bean.roastDate)}` : '', `${a.cups}杯（★あり ${a.rated}杯）`].filter(Boolean).join('・')),
    el('p', { class: a.peak ? '' : 'muted' }, a.line),
  );
  if (a.rated > 0) card.append(agingChart(a));
  const list = el('ol', { class: 'aging-list' }, ...a.entries.map(entryItem));
  card.append(open ? el('div', {}, el('h3', { class: 'section-title' }, '杯ごとの記録（日数順）'), list) : el('details', {}, el('summary', {}, `杯ごとの記録（${a.entries.length}杯・日数順）`), list));
  if (!isDemo() && !open) card.append(el('p', {}, el('a', { href: `bean.html?id=${encodeURIComponent(a.bean.id)}` }, 'この豆の画面を開く')));
  return card;
}

async function render() {
  const data = await loadAnalysisData();
  const rows = analysisRows(data);
  const all = agingAll(data.beans, rows);
  const only = queryParam('bean');
  const intro = el(
    'section',
    { class: 'card' },
    el('p', { class: 'muted small' }, withTerm('焙煎後日数', 'days-off-roast'), 'は、冷凍の袋を使った杯では冷凍していた日を除いて数えます。', withTerm('飲み頃の山', 'peak'), `は★と日数のある杯が${AGING_MIN}杯から出します。`),
    starLegend(),
  );
  if (only) {
    const a = all.find((x) => x.bean.id === only);
    const bean = data.beans.find((b) => b.id === only);
    if (!bean) {
      $('content').replaceChildren(el('section', { class: 'card' }, el('p', { class: 'error' }, '豆が見つかりません。削除したのかもしれません'), el('p', {}, el('a', { href: analysisHref('aging.html') }, '全部の豆の日誌を見る'))));
      return;
    }
    $('content').replaceChildren(
      a ? beanCard(a, true) : el('section', { class: 'card' }, el('h2', {}, bean.name), el('p', { class: 'muted' }, 'まだ記録はありません。焙煎日を入れた豆で淹れると、日数ごとに並べます。')),
      intro,
      el('p', {}, el('a', { href: analysisHref('aging.html') }, '全部の豆の日誌を見る')),
    );
    return;
  }
  if (!all.length) {
    $('content').replaceChildren(el('section', { class: 'card' }, el('p', { class: 'muted' }, 'まだ記録はありません。焙煎日を入れた豆で淹れて★を付けると表示します。')));
    return;
  }
  const peaks = all.filter((a) => a.peak);
  const summary = el(
    'section',
    { class: 'card' },
    el('h2', {}, '豆ごとの飲み頃の山'),
    peaks.length
      ? el('ul', { class: 'aging-list' }, ...peaks.map((a) => el('li', {}, el('p', {}, el('strong', {}, a.bean.name)), el('p', {}, `山 ${a.peak.label}（平均★${a.peak.mean}・${a.peak.n}杯）`))))
      : el('p', { class: 'muted' }, `まだ山の出た豆はありません。同じ日数の区切りで★のある杯が2杯ずつたまると出ます。`),
  );
  $('content').replaceChildren(summary, intro, ...all.map((a) => beanCard(a, false)));
}

registerServiceWorker();
setupAnalysisPage();
render().catch((err) => showLoadError(err));
