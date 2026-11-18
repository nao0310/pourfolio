// 分析の入口：件数のまとめと、各画面（E2〜E5・E8・コスト）の「使えるか／あと○杯」
import { loadAnalysisData, setupAnalysisPage, analysisHref, isDemo, showLoadError } from './analysis-data.js';
import { analysisRows, ratedRows, readiness, readinessText, THRESHOLDS } from './core/analysis.js';
import { beanJourneys } from './core/dialin-history.js';
import { chartPoints, favoriteZone } from './core/brew-chart.js';
import { roastCurves } from './core/factors.js';
import { preferenceBy, topLine } from './core/preference.js';
import { todayCaffeine } from './core/caffeine.js';
import { lifeReadiness, weatherCount } from './core/life.js';
import { $, el } from './ui.js';
import { registerServiceWorker } from './pwa.js';

function entry(href, title, status, ready) {
  return el(
    'a',
    { class: 'list-row analysis-entry', href },
    el('span', { class: 'list-row-main' }, el('span', { class: 'list-row-title' }, title), el('span', { class: 'muted' }, status)),
    el('span', { class: `pill ${ready ? 'ready' : 'waiting'}` }, ready ? '見られます' : '準備中'),
  );
}

async function render() {
  const data = await loadAnalysisData();
  const rows = analysisRows(data);
  const rated = ratedRows(rows);
  const journeys = beanJourneys(rows, data.suggestions);
  const readyBeans = journeys.filter((j) => j.ready.ready).length;
  const pts = chartPoints(rows);
  const zone = favoriteZone(pts);
  const factorsReady = readiness(rated.length, THRESHOLDS.factors);
  const curves = roastCurves(rows).filter((c) => c.ready.ready).length;
  const profileReady = readiness(rated.length, THRESHOLDS.profile);
  const lifeReady = lifeReadiness(rows);
  // 今日はホームと同じ朝5時区切り（2-8の37番）
  const today = todayCaffeine(rows, new Date());

  const summary = el(
    'section',
    { class: 'card' },
    el('h2', {}, 'これまでの記録'),
    el(
      'dl',
      { class: 'plan-numbers' },
      el('dt', {}, '淹れた杯'),
      el('dd', { class: 'num' }, `${rows.length}杯（★あり ${rated.length}杯）`),
      el('dt', {}, 'TDS付き'),
      el('dd', { class: 'num' }, `${pts.length}杯`),
      el('dt', {}, '豆'),
      el('dd', { class: 'num' }, `${journeys.length}袋`),
      el('dt', {}, '今日'),
      el('dd', { class: 'num' }, today.cups ? `${today.cups}杯・カフェイン約${today.mg}mg` : 'まだ淹れていません'),
    ),
    profileReady.ready ? el('p', {}, topLine(preferenceBy(rows, 'origin'), '産地')) : null,
  );

  const list = el(
    'section',
    { class: 'card' },
    el('h2', {}, '見る'),
    el(
      'div',
      { class: 'list' },
      entry(
        analysisHref('dialin-history.html'),
        'ダイヤルインの道のり',
        readyBeans ? `${readyBeans}袋の道のりを見られます` : `1つの豆で${THRESHOLDS.dialin}杯から表示します`,
        readyBeans > 0,
      ),
      entry(
        analysisHref('brew-chart.html'),
        '抽出チャート',
        pts.length
          ? zone.zone
            ? `TDS付き${pts.length}杯・自分の好きゾーンあり`
            : `TDS付き${pts.length}杯。好きゾーンは${zone.ready ? '★4以上の杯がもう少し要ります' : readinessText(zone)}`
          : 'TDS（屈折計の値）を入れた杯から表示します',
        pts.length > 0,
      ),
      entry(
        analysisHref('factors.html'),
        '条件と評価',
        factorsReady.ready ? `★のある${rated.length}杯から${curves ? `・飲み頃カーブ${curves}つ` : ''}` : readinessText(factorsReady),
        factorsReady.ready,
      ),
      entry(analysisHref('profile.html'), '嗜好プロファイル', profileReady.ready ? `★のある${rated.length}杯から` : readinessText(profileReady), profileReady.ready),
      entry(analysisHref('life.html'), '生活との関係', lifeReady.ready ? `時間帯・曜日・気分・天気・季節と★（天気の付いた杯 ${weatherCount(rows)}杯）` : readinessText(lifeReady), lifeReady.ready),
      entry(analysisHref('calendar.html'), 'カレンダーとカフェイン', rows.length ? '毎日の杯数とカフェインの目安' : '淹れた日から表示します', rows.length > 0),
      isDemo() ? null : entry('cost.html', 'コスト', '1杯の単価・月の支出・満足度あたりの値段', true),
      entry(analysisHref('report.html'), '月次レポート', '1か月の杯数・ベスト3・産地・支出・好みの変化を1枚に（印刷・PDF）', true),
    ),
  );

  const demoCard = isDemo()
    ? null
    : el(
        'section',
        { class: 'card' },
        el('h2', {}, 'デモで見る'),
        el('p', { class: 'muted' }, '記録がまだ少ないときは、作り話の記録（豆8袋・80杯）で、どんな画面になるかを見られます。あなたのデータには書き込みません。'),
        el('a', { class: 'btn secondary', href: 'analysis.html?demo=1' }, 'デモで見る'),
      );

  $('content').replaceChildren(summary, list, demoCard ?? '');
}

registerServiceWorker();
setupAnalysisPage();
render().catch((err) => showLoadError(err));
