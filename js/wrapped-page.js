// 年間まとめ「Coffee Wrapped」（X5）：1年を全画面のカードで振り返る（計算は js/core/wrapped.js）
// ?year=YYYY。分析と同じく ?demo=1 ならデモデータで見る（端末のデータには書かない）。
// カードは横に並べ、スワイプ（scroll-snap）・右側／左側を押す・「次へ」「前へ」・矢印キーで動く。
import { wrappedSlides, wrappedYears, isYear, wrappedImageContent, defaultWrappedYear } from './core/wrapped.js';
import { landPath, MAP_W, MAP_H, BELT_LAT, project } from './core/origin-map.js';
import { yen } from './core/cost.js';
import { formatYmdJa, localYmd } from './core/format.js';
import { loadAnalysisData, isDemo, analysisHref, setupAnalysisPage } from './analysis-data.js';
import { plot, svg } from './chart.js';
import { drawWrappedImage } from './wrapped-image.js';
import { canvasToFile } from './brew-image.js';
import { $, el, queryParam, showMessage } from './ui.js';
import { clip } from './core/card-text.js';
import { registerServiceWorker } from './pwa.js';

let data = null;
let current = null;
let imageUrl = null;

const big = (text, cls = '') => el('p', { class: `wr-big num ${cls}`.trim() }, text);
const sub = (text) => el('p', { class: 'wr-sub' }, text);
const head = (text) => el('h2', { class: 'wr-title' }, text);
const kv = (label, value, note = '') => el('div', { class: 'wr-kv' }, el('span', { class: 'wr-kv-label' }, label), el('span', { class: 'wr-kv-value num' }, value), note ? el('span', { class: 'wr-kv-note' }, note) : '');

function monthBars(s) {
  const max = Math.max(1, ...s.byMonth.map((m) => m.cups));
  return plot({
    ariaLabel: `月ごとの杯数。いちばん多いのは${s.topMonth ? `${s.topMonth.month}月の${s.topMonth.cups}杯` : 'なし'}`,
    width: 340,
    height: 180,
    x: { min: 0.5, max: 12.5, ticks: 12, labels: Object.fromEntries(s.byMonth.map((m) => [m.month, String(m.month)])), format: (n) => String(n) },
    y: { min: 0, max, ticks: 3, format: (n) => String(Math.round(n)) },
    bars: s.byMonth.map((m) => ({ x: m.month, y: m.cups, title: `${m.month}月 ${m.cups}杯` })),
    barWidth: 0.8,
  });
}

function starLine(months) {
  return plot({
    ariaLabel: `月ごとの平均★：${months.map((m) => `${m.month}月 ★${m.avg}`).join('、')}`,
    width: 340,
    height: 180,
    x: { min: 0.5, max: 12.5, ticks: 12, format: (n) => String(n) },
    y: { min: 1, max: 5, ticks: 4, format: (n) => `★${n}` },
    lines: [{ points: months.map((m) => [m.month, m.avg]), cls: 'series' }],
    points: months.map((m) => ({ x: m.month, y: m.avg, level: Math.round(m.avg), title: `${m.month}月 平均★${m.avg}（${m.n}杯）` })),
  });
}

function originSvg(s) {
  const max = Math.max(1, ...s.list.map((o) => o.cups));
  const belt0 = project([0, BELT_LAT]).y;
  const belt1 = project([0, -BELT_LAT]).y;
  const dots = s.list.filter((o) => o.pos);
  return svg(
    'svg',
    { viewBox: `0 0 ${MAP_W} ${MAP_H}`, class: 'wr-map', role: 'img', 'aria-label': `飲んだ産地の地図：${s.list.map((o) => `${o.key} ${o.cups}杯`).join('、')}` },
    svg('rect', { class: 'wr-map-sea', x: 0, y: 0, width: MAP_W, height: MAP_H }),
    svg('rect', { class: 'wr-map-belt', x: 0, y: belt0, width: MAP_W, height: belt1 - belt0 }),
    svg('path', { class: 'wr-map-land', d: landPath() }),
    ...dots.map((o) => svg('circle', { class: 'wr-map-dot', cx: o.pos.x, cy: o.pos.y, r: (2.5 + Math.sqrt(o.cups / max) * 4.5).toFixed(1) }, svg('title', {}, `${o.key} ${o.cups}杯`))),
  );
}

const SLIDES = {
  cover: (s, r) => [el('p', { class: 'wr-kicker' }, `Pourfolio${isDemo() ? '（デモ）' : ''}`), el('h2', { class: 'wr-cover-title' }, `${s.year}年の`, el('br'), 'コーヒー'), sub(s.period), r.cups ? sub(`${r.cups}杯を振り返ります`) : sub('この年の記録はありません。淹れると、ここに1年のまとめができます')],
  cups: (s) => [
    head('淹れた杯'),
    big(`${s.cups}杯`),
    sub(`${s.days}日・${s.beans}種類の豆`),
    s.streak >= 2 ? kv('続けて淹れた最長', `${s.streak}日`) : '',
    s.topMonth ? kv('いちばん淹れた月', `${s.topMonth.month}月`, `${s.topMonth.cups}杯`) : '',
    el('figure', { class: 'chart' }, monthBars(s)),
  ],
  origins: (s) => [
    head('飲んだ産地'),
    big(`${s.countries}か国`),
    el('figure', { class: 'chart' }, originSvg(s), el('figcaption', { class: 'muted small' }, '色の帯はコーヒーベルト（北回帰線〜南回帰線）。点が大きいほど多く飲んだ産地です')),
    el('ol', { class: 'wr-rank' }, ...s.list.slice(0, 5).map((o) => el('li', {}, el('span', {}, o.key), el('span', { class: 'num' }, `${o.cups}杯`)))),
    s.list.length > 5 ? sub(`ほか${s.list.length - 5}か所`) : '',
    s.list.some((o) => !o.pos) ? el('p', { class: 'muted small' }, `地図に位置のない産地：${s.list.filter((o) => !o.pos).map((o) => o.key).join('、')}`) : '',
  ],
  best: (s) => [
    head('ベスト'),
    s.favorite ? el('div', { class: 'wr-fav' }, el('span', { class: 'wr-kv-label' }, 'いちばん好きだった豆'), el('span', { class: 'wr-fav-name' }, clip(s.favorite.name, 36)), el('span', { class: 'muted' }, `平均★${s.favorite.avg}・${s.favorite.n}杯${s.favorite.roastLevel ? `・${s.favorite.roastLevel}` : ''}`)) : '',
    el('h3', { class: 'wr-h3' }, '★の高い3杯'),
    el('ol', { class: 'wr-best' }, ...s.top.map((b) => el('li', {}, el(isDemo() ? 'span' : 'a', isDemo() ? { class: 'wr-best-row' } : { class: 'wr-best-row', href: `tasting.html?brew=${encodeURIComponent(b.brewId)}` }, el('span', { class: 'num wr-star' }, `★${b.stars}`), el('span', { class: 'wr-best-name' }, `${clip(b.beanName, 36)}${b.roastLevel ? `（${b.roastLevel}）` : ''}`), el('span', { class: 'muted num' }, `${formatYmdJa(b.ymd)}${b.ratio ? `・1:${b.ratio}` : ''}`))))),
  ],
  taste: (s) => [head('好みの傾向'), ...s.items.map((t) => kv(`いちばん★が高かった${t.label}`, t.value, `平均★${t.mean}・${t.n}杯`)), el('p', { class: 'muted small' }, '★の平均を杯数で全体の平均に寄せた嗜好スコアで比べています（3杯以上の区分だけ）')],
  growth: (s) => [
    head('成長の記録'),
    s.line ? sub(s.line) : '',
    s.months.length >= 2 ? el('figure', { class: 'chart' }, starLine(s.months), el('figcaption', { class: 'muted small' }, '月ごとの平均★')) : '',
    s.cupsTo90 != null ? kv('豆ごとのベストの9割に届くまで', `平均${s.cupsTo90}杯`) : '',
    s.repro ? kv('再現性スコア', `${s.repro.first} → ${s.repro.second}`, '年の前半の杯 → 後半の杯') : '',
  ],
  effect: (s) => [
    head('提案の効果'),
    big(`★${s.beforeAvg} → ★${s.afterAvg}`, s.afterAvg > s.beforeAvg ? 'wr-up' : ''),
    sub(s.line),
    el('div', { class: 'wr-split' }, kv('上がった', `${s.up}回`), kv('同じ', `${s.same}回`), kv('下がった', `${s.down}回`)),
    el('p', { class: 'muted small' }, '評価のあとの提案（ダイヤルイン）どおりに淹れた次の杯と、提案の元になった杯の★を比べています'),
  ],
  life: (s) => [
    head('天気と生活'),
    s.iced ? kv('アイスで淹れた杯', `${s.iced}杯`, `ホット ${s.hot}杯`) : kv('ホットで淹れた杯', `${s.hot}杯`),
    s.weather ? kv('天気の付いた杯', `${s.weather}杯`) : '',
    ...s.lines.map((t) => el('p', { class: 'wr-line' }, t)),
    !s.ready ? el('p', { class: 'muted small' }, '★のある杯が30杯たまると、時間帯や気温と★の関係も出します') : el('p', { class: 'muted small' }, '一緒に動いているだけで、原因とは限りません'),
  ],
  aging: (s) => [head('飲み頃'), sub('焙煎後'), big(`${s.days}日ごろ`), sub(`飲み頃の山が出た${s.beans}つの豆の平均です`), kv('山がいちばん高かった豆', clip(s.best.name, 36), `${s.best.label}・平均★${s.best.mean}`)],
  money: (s) => [
    head('お金とカフェイン'),
    kv('買った豆', yen(s.boughtJpy), `${s.bags}袋・送料込み${s.unpricedBags ? `（価格なし${s.unpricedBags}袋）` : ''}`),
    s.perCupJpy != null
      ? kv('飲んだ豆の原価', yen(s.drankJpy), `1杯 約${yen(s.perCupJpy)}${s.uncostedCups ? `（原価のない${s.uncostedCups}杯を除く）` : ''}`)
      : kv('飲んだ豆の原価', '—', '豆の価格と重さを入れると出します'),
    kv('使った豆', `${s.gramsUsed.toLocaleString('ja-JP')}g`),
    kv('カフェイン', `約${(s.caffeineMg / 1000).toFixed(1)}g`, 'カフェインレスを除く目安'),
  ],
  summary: (s) => [
    head(`${s.year}年のまとめ`),
    el('div', { class: 'wr-grid' }, kv('杯数', `${s.cups}杯`), kv('飲んだ日', `${s.days}日`), kv('豆', `${s.beans}種類`), kv('産地', `${s.countries}か国`), kv('平均の★', s.avgStars != null ? `★${s.avgStars}` : '—'), kv('使った豆', `${s.gramsUsed.toLocaleString('ja-JP')}g`)),
    s.favorite ? kv('いちばん好きだった豆', clip(s.favorite.name, 36), `平均★${s.favorite.avg}`) : '',
    s.effect ? kv('提案の効果', `★${s.effect.beforeAvg} → ★${s.effect.afterAvg}`, `${s.effect.n}回`) : '',
    el(
      'div',
      { class: 'wr-image' },
      el('button', { class: 'btn block secondary', type: 'button', id: 'imageMake' }, '画像にする'),
      el('img', { class: 'brew-image', id: 'imagePreview', alt: '年間まとめの画像', hidden: true }),
      el('div', { class: 'stack', id: 'imageActions', hidden: true }, el('button', { class: 'btn block', type: 'button', id: 'imageShare', hidden: true }, '共有・保存'), el('a', { class: 'btn block secondary', id: 'imageDownload', download: '' }, 'ダウンロード')),
      el('p', { id: 'imageMsg', role: 'status' }),
    ),
  ],
};

function slideIndex() {
  const deck = $('deck');
  return Math.max(0, Math.min(deck.children.length - 1, Math.round(deck.scrollLeft / Math.max(1, deck.clientWidth))));
}

function updateCount() {
  const n = $('deck').children.length;
  const i = slideIndex();
  $('count').textContent = `${i + 1} / ${n}`;
  $('prevBtn').disabled = i === 0;
  $('nextBtn').disabled = i >= n - 1;
  [...$('deck').children].forEach((c, k) => c.setAttribute('aria-hidden', k === i ? 'false' : 'true'));
}

function go(delta) {
  const deck = $('deck');
  const i = Math.max(0, Math.min(deck.children.length - 1, slideIndex() + delta));
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  deck.scrollTo({ left: i * deck.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
  // スクロールの知らせが来ない場合（動きを減らす設定など）にも数を合わせる
  setTimeout(updateCount, 400);
}

async function makeImage() {
  const btn = $('imageMake');
  btn.disabled = true;
  try {
    const summary = current.slides.find((s) => s.key === 'summary');
    const file = await canvasToFile(drawWrappedImage(wrappedImageContent(summary, current.period)), `pourfolio-wrapped-${current.year}.png`);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = URL.createObjectURL(file);
    $('imagePreview').src = imageUrl;
    $('imagePreview').hidden = false;
    $('imageDownload').href = imageUrl;
    $('imageDownload').download = file.name;
    $('imageShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    $('imageShare').onclick = async () => {
      try {
        await navigator.share({ files: [file], title: file.name });
      } catch (err) {
        if (err?.name !== 'AbortError') showMessage('共有できませんでした。「ダウンロード」を使ってください', 'error', 'imageMsg');
      }
    };
    $('imageActions').hidden = false;
    btn.textContent = '作り直す';
    showMessage('', 'ok', 'imageMsg');
  } catch (err) {
    console.error(err);
    showMessage('画像を作れませんでした', 'error', 'imageMsg');
  } finally {
    btn.disabled = false;
  }
}

function render(year) {
  current = wrappedSlides(data, year, localYmd());
  document.title = `${year}年のまとめ - Pourfolio`;
  const deck = $('deck');
  deck.replaceChildren(...current.slides.map((s, i) => el('section', { class: `wr-slide wr-s-${s.key}`, 'aria-label': `${i + 1}枚目` }, ...SLIDES[s.key](s, current))));
  deck.scrollLeft = 0;
  $('imageMake')?.addEventListener('click', makeImage);
  updateCount();
}

/** カードの右側を押すと次へ、左側（3分の1）を押すと前へ。リンク・ボタン・図の点を押したときは動かない */
function onDeckClick(e) {
  if (e.target.closest('a, button, input, select, label, img')) return;
  const rect = $('deck').getBoundingClientRect();
  go(e.clientX - rect.left < rect.width / 3 ? -1 : 1);
}

async function init() {
  data = await loadAnalysisData();
  const years = wrappedYears(data.brews, localYmd());
  const want = queryParam('year');
  const year = isYear(want) ? want : defaultWrappedYear(localYmd(), years);
  if (!years.includes(year)) years.unshift(year);
  $('year').replaceChildren(...years.map((y) => el('option', { value: y }, `${y}年`)));
  $('year').value = year;
  $('year').addEventListener('change', () => {
    history.replaceState(null, '', analysisHref('wrapped.html', { year: $('year').value }));
    render($('year').value);
  });
  render(year);
}

let scrollTimer = null;
$('deck').addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(updateCount, 80);
});
$('deck').addEventListener('click', onDeckClick);
$('deck').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    go(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    go(-1);
  }
});
$('prevBtn').addEventListener('click', () => go(-1));
$('nextBtn').addEventListener('click', () => go(1));
window.addEventListener('resize', () => {
  const i = slideIndex();
  $('deck').scrollLeft = i * $('deck').clientWidth;
});
setupAnalysisPage();
registerServiceWorker();
init().catch((err) => {
  console.error(err);
  $('deck').replaceChildren(el('section', { class: 'wr-slide' }, el('p', { class: 'error' }, '読み込めませんでした。開き直してください')));
});
