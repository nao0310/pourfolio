// 嗜好プロファイル（E5）：区分ごとの嗜好スコア（件数と信頼度つき）、組み合わせの表、味の好みの位置
import { loadAnalysisData, setupAnalysisPage, showLoadError } from './analysis-data.js';
import { analysisRows, ratedRows, readiness, readinessText, THRESHOLDS } from './core/analysis.js';
import { DIMENSIONS, preferenceBy, heatmap, likingPeaks } from './core/preference.js';
import { $, el } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const pct = (score) => `${Math.max(0, Math.min(100, ((score - 1) / 4) * 100))}%`;

function dimCard(rows, dim) {
  const list = preferenceBy(rows, dim.key);
  const card = el('section', { class: 'card' }, el('h2', {}, dim.label));
  if (!list.length) {
    card.append(el('p', { class: 'muted' }, `まだ${dim.label}を入れた豆の記録はありません。豆の登録で${dim.label}を入れて淹れると表示します`));
    return card;
  }
  card.append(
    el(
      'ol',
      { class: 'taste-list' },
      ...list.map((p) =>
        el(
          'li',
          { class: 'taste-row' },
          el('span', { class: 'taste-name' }, p.key),
          el('span', { class: 'taste-bar-box', 'aria-hidden': 'true' }, el('span', { class: 'taste-bar', style: `width:${pct(p.score)}` })),
          el('span', { class: 'taste-num num' }, p.score.toFixed(2)),
          el('span', { class: `taste-meta muted small conf-${p.confidence.level}` }, `${p.n}杯・平均★${p.mean}・信頼度${p.confidence.text}`),
        ),
      ),
    ),
  );
  return card;
}

function heatCard(rows, rowDim, title) {
  const hm = heatmap(rows, rowDim);
  const card = el('section', { class: 'card' }, el('h2', {}, title), el('p', { class: 'muted small' }, 'マスの濃さが嗜好スコア、数字が杯数です。空いているマスは、まだ飲んでいない組み合わせです。'));
  if (!hm.rows.length) {
    card.append(el('p', { class: 'muted' }, 'まだ記録はありません。豆を登録して、淹れて評価すると表示します'));
    return card;
  }
  const level = (s) => Math.max(1, Math.min(5, Math.round(s)));
  card.append(
    el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'heatmap' },
        el('thead', {}, el('tr', {}, el('th', {}, ''), ...hm.cols.map((c) => el('th', { scope: 'col' }, c)))),
        el(
          'tbody',
          {},
          ...hm.rows.map((r) =>
            el(
              'tr',
              {},
              el('th', { scope: 'row' }, r),
              ...hm.cols.map((c) => {
                const cell = hm.cells[r][c];
                return cell
                  ? el('td', { class: `heat lv-${level(cell.score)}`, title: `${r}×${c}：スコア${cell.score}（${cell.n}杯）` }, el('span', { class: 'heat-score num' }, cell.score.toFixed(1)), el('span', { class: 'heat-n' }, `${cell.n}杯`))
                  : el('td', { class: 'heat empty' }, '—');
              }),
            ),
          ),
        ),
      ),
    ),
  );
  return card;
}

function likingCard(tastings) {
  const lp = likingPeaks(tastings);
  const card = el(
    'section',
    { class: 'card' },
    el('h2', {}, '味の好みの位置'),
    el('p', { class: 'muted small' }, '詳しい評価（強さ0〜15と好み1〜9）から、項目ごとに好みがいちばん高い強さの区切りです。'),
  );
  if (!lp.ready.ready) {
    card.append(el('p', { class: 'muted' }, readinessText(lp.ready, '件')), el('p', { class: 'muted small' }, '評価の画面の「詳しく評価する（強さと好み）」で入れた件数です。'));
    return card;
  }
  card.append(
    el(
      'dl',
      { class: 'plan-numbers' },
      ...lp.attrs.flatMap((a) => [
        el('dt', {}, a.label),
        el('dd', {}, a.peak ? `強さ ${a.peak.label} が好き（好み平均 ${a.peak.mean}・${a.peak.n}件）` : 'まだ分かりません'),
      ]),
    ),
  );
  return card;
}

async function render() {
  const data = await loadAnalysisData();
  const rows = analysisRows(data);
  const rated = ratedRows(rows);
  const ready = readiness(rated.length, THRESHOLDS.profile);
  const tastings = data.tastings.filter((t) => (t.by ?? 'me') === 'me');
  if (!ready.ready) {
    $('content').replaceChildren(
      el('section', { class: 'card' }, el('p', {}, readinessText(ready)), el('p', { class: 'muted' }, `★を付けた杯が${THRESHOLDS.profile}杯たまると、好みの区分を出します。`)),
      likingCard(tastings),
    );
    return;
  }
  $('content').replaceChildren(
    ...DIMENSIONS.map((d) => dimCard(rows, d)),
    heatCard(rows, 'origin', '産地×焙煎度'),
    heatCard(rows, 'process', '精製×焙煎度'),
    likingCard(tastings),
    el('p', { class: 'muted small' }, `嗜好スコア＝（杯数×その区分の平均★＋5×全体の平均★）÷（杯数＋5）。信頼度は杯数で決めています（5杯未満は低、15杯未満は中）。`),
  );
}

registerServiceWorker();
setupAnalysisPage();
render().catch((err) => showLoadError(err));
