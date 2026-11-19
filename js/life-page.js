// 生活との関係（E6）と季節の好みの変化（X20）：区分ごとの嗜好スコアの横棒、時間帯ごとの焙煎度、季節のまとめ
import { loadAnalysisData, setupAnalysisPage, showLoadError, isDemo } from './analysis-data.js';
import { analysisRows, ratedRows, readinessText } from './core/analysis.js';
import { LIFE_DIMENSIONS, MIN_GROUP, lifeBy, lifeLine, roastByBand, seasonSummary, seasonLine, lifeReadiness, weatherCount, LIFE_NEED } from './core/life.js';
import { WEATHER_CREDIT, WEATHER_CREDIT_URL } from './core/weather.js';
import { $, el, termHelp, withTerm } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const pct = (score) => `${Math.max(0, Math.min(100, ((score - 1) / 4) * 100))}%`;

function dimCard(rows, dim, hasWeather) {
  const res = lifeBy(rows, dim.key);
  const card = el('section', { class: 'card' }, el('h2', {}, res.label));
  if (res.needsWeather && !hasWeather) {
    card.append(
      el('p', { class: 'muted' }, 'まだ天気の付いた杯はありません。天気の地点を決めて淹れると表示します'),
      isDemo() ? null : el('p', {}, el('a', { href: 'weather.html' }, '天気の地点を決める')),
    );
    return card;
  }
  if (!res.shown.length) {
    card.append(el('p', { class: 'muted' }, `どの区分も★のある杯が${MIN_GROUP}杯に届いていません${res.counted ? `（いま${res.counted}杯）` : ''}。`));
    return card;
  }
  const line = lifeLine(res);
  if (line) card.append(el('p', {}, line));
  card.append(
    el(
      'ol',
      { class: 'taste-list' },
      ...res.shown.map((g) =>
        el(
          'li',
          { class: 'taste-row' },
          el('span', { class: 'taste-name' }, g.label),
          el('span', { class: 'taste-bar-box', 'aria-hidden': 'true' }, el('span', { class: 'taste-bar', style: `width:${pct(g.score)}` })),
          el('span', { class: 'taste-num num' }, g.score.toFixed(2)),
          el('span', { class: 'taste-meta muted small' }, `${g.n}杯・平均★${g.mean}`),
        ),
      ),
    ),
  );
  if (res.few.length) card.append(el('p', { class: 'muted small' }, `${MIN_GROUP}杯未満で出していない区分：${res.few.map((f) => `${f.label} ${f.n}杯`).join('、')}`));
  return card;
}

function bandRoastCard(rows) {
  const list = roastByBand(rows).filter((b) => b.n > 0);
  const card = el('section', { class: 'card' }, el('h2', {}, '時間帯ごとによく選んだ焙煎度'), el('p', { class: 'muted small' }, '★を付けなかった杯も数えています。'));
  if (!list.length) {
    card.append(el('p', { class: 'muted' }, 'まだ記録はありません。淹れると表示します'));
    return card;
  }
  card.append(
    el(
      'dl',
      { class: 'plan-numbers' },
      ...list.flatMap((b) => [el('dt', {}, b.label), el('dd', {}, b.group ? `${b.groupLabel}が${b.share}%（${b.n}杯）` : `焙煎度の分かる豆がありません（${b.n}杯）`)]),
    ),
  );
  return card;
}

function seasonCard(rows) {
  const list = seasonSummary(rows);
  return el(
    'section',
    { class: 'card' },
    el('h2', {}, '季節ごとの好み'),
    el('p', { class: 'muted small' }, '春3〜5月・夏6〜8月・秋9〜11月・冬12〜2月。季節の変わり目（3・6・9・12月の前半）には、去年の同じ季節の好みをホームに出します。'),
    el('dl', { class: 'plan-numbers' }, ...list.flatMap((s) => [el('dt', {}, s.label), el('dd', {}, seasonLine(s))])),
  );
}

async function render() {
  const data = await loadAnalysisData();
  const rows = analysisRows(data);
  const ready = lifeReadiness(rows);
  const wCount = weatherCount(rows);
  const credit = el('p', { class: 'muted small' }, '天気：', el('a', { href: WEATHER_CREDIT_URL, rel: 'noopener', target: '_blank' }, WEATHER_CREDIT));
  if (!ready.ready) {
    $('content').replaceChildren(
      el(
        'section',
        { class: 'card' },
        el('p', {}, readinessText(ready)),
        el('p', { class: 'muted' }, `★を付けた杯が${LIFE_NEED}杯たまると、時間帯や天気ごとの★を出します。`),
        el('p', { class: 'muted small' }, `天気の付いた杯：${wCount}杯`),
      ),
      credit,
    );
    return;
  }
  $('content').replaceChildren(
    el(
      'section',
      { class: 'card' },
      el('p', {}, `★のある${ratedRows(rows).length}杯から。天気の付いた杯は${wCount}杯です。`),
      el('p', { class: 'muted small' }, '数字は嗜好スコア（区分の杯が少ないほど全体の平均に寄せた★）。棒は★1〜5の幅です。', termHelp('preference-score')),
    ),
    ...LIFE_DIMENSIONS.filter((d) => d.key !== 'season').map((d) => dimCard(rows, d, wCount > 0)),
    bandRoastCard(rows),
    dimCard(rows, LIFE_DIMENSIONS.find((d) => d.key === 'season'), wCount > 0),
    seasonCard(rows),
    credit,
  );
}

registerServiceWorker();
setupAnalysisPage();
render().catch((err) => showLoadError(err));
