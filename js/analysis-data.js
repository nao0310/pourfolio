// 分析の画面の共通部分：データの読み込み（?demo=1 ならデモデータ。端末のデータには書かない D-117）、
// デモの帯、画面どうしのリンク
import { openDb, readAll } from './db.js';
import { makeDemoData } from './core/demo-data.js';
import { $, el, queryParam } from './ui.js';

const alive = (r) => r && r.deletedAt == null;

/** デモで見ているか */
export const isDemo = () => queryParam('demo') === '1';

/** 分析の画面へのリンク（デモで見ているときは ?demo=1 を付けたまま） */
export function analysisHref(page, params = {}) {
  const q = new URLSearchParams(params);
  if (isDemo()) q.set('demo', '1');
  const s = q.toString();
  return s ? `${page}?${s}` : page;
}

/**
 * 分析に使う表を読む（削除済みは除く）。
 * @returns {Promise<{demo:boolean, beans:object[], brews:object[], tastings:object[], suggestions:object[], equipment:object[], recipes:object[], orders?:object[]}>}
 */
export async function loadAnalysisData() {
  if (isDemo()) return { demo: true, ...makeDemoData() };
  const all = await readAll(openDb());
  const out = { demo: false };
  for (const k of ['beans', 'brews', 'tastings', 'suggestions', 'equipment', 'recipes', 'orders']) out[k] = (all[k] ?? []).filter(alive);
  return out;
}

/** デモの帯（画面の上）と、パンくずのリンクを分析の入口に向ける */
export function setupAnalysisPage() {
  const crumb = document.querySelector('.crumb a[data-analysis]');
  if (crumb) crumb.href = analysisHref('analysis.html');
  for (const a of document.querySelectorAll('a[data-analysis-link]')) a.href = analysisHref(a.getAttribute('href'));
  if (!isDemo()) return;
  const main = document.querySelector('main');
  const page = location.pathname.split('/').pop() || 'analysis.html';
  main.prepend(
    el(
      'div',
      { class: 'demo-bar', role: 'note' },
      el('span', {}, 'デモデータを表示しています（作り話の記録です。あなたのデータは変わりません）'),
      el('a', { class: 'btn secondary small', href: page }, '自分のデータに戻る'),
    ),
  );
}

/** 読み込みに失敗したとき */
export function showLoadError(err, id = 'content') {
  console.error(err);
  $(id)?.replaceChildren(el('p', { class: 'error' }, '読み込みに失敗しました'));
}
