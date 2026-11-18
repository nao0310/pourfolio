// 理論カードと用語辞典（X25）：区分ごとの用語。#t-<id> で開くとその項目に移って色を付ける
import { glossaryByGroup, termById, termHref } from './core/glossary.js';
import { $, el } from './ui.js';
import { registerServiceWorker } from './pwa.js';

function termItem(t) {
  return el(
    'article',
    { class: 'glossary-term', id: `t-${t.id}` },
    el('h3', {}, t.word),
    el('p', {}, el('strong', {}, t.short)),
    el('p', {}, t.detail),
    el('p', { class: 'glossary-app small' }, el('span', { class: 'muted' }, 'このアプリでは：'), t.app),
    t.see?.length
      ? el(
          'p',
          { class: 'glossary-see mini-links' },
          ...t.see.map((id) => termById(id)).filter(Boolean).map((s) => el('a', { href: termHref(s.id) }, s.word)),
        )
      : null,
  );
}

function render() {
  const groups = glossaryByGroup();
  const index = el(
    'nav',
    { class: 'card', 'aria-label': '区分' },
    el('p', { class: 'glossary-index mini-links' }, ...groups.map((g) => el('a', { href: `#g-${g.key}` }, g.label))),
  );
  $('content').replaceChildren(
    index,
    ...groups.map((g) => el('section', { class: 'card', id: `g-${g.key}` }, el('h2', {}, g.label), ...g.terms.map(termItem))),
  );
  // 描き終えてから、# の項目へ移る（あとから作った要素なので、ブラウザは自分では移らない）
  const id = decodeURIComponent(location.hash.slice(1));
  if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

/** 戻る：アプリの画面から来たら前の画面へ（# の移動も含めて1つ戻る）、そうでなければ「その他」 */
function setupBack() {
  const back = $('backLink');
  let fromApp = false;
  try {
    fromApp = document.referrer && new URL(document.referrer).origin === location.origin && !new URL(document.referrer).pathname.endsWith('/glossary.html');
  } catch {
    fromApp = false;
  }
  if (!fromApp) return;
  const startLen = history.length;
  back.addEventListener('click', (e) => {
    e.preventDefault();
    // 辞典の中で「関連」の項目に移った分も戻る
    const extra = history.length - startLen;
    history.go(-(extra + 1));
  });
}

registerServiceWorker();
render();
setupBack();
addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
});
