// 味の評価の入力部品（評価の画面と、焙煎度比較の飲み比べで使う）
// どの部品も「入力中の評価 state を直接書き換え、onChange を呼ぶ」。state の形は core/tastings.js の emptyTastingInput。
import { STAR_MAX, QUICK_TAGS, JAR_ATTRS, DETAIL_ATTRS, INTENSITY_MAX, LIKING_WORDS, detailAnsweredCount } from './core/tastings.js';
import { FLAVOR_WHEEL, DEFECT_TAGS, countInCategory, toggleFlavor, flavorLabel } from './core/flavors.js';
import { el } from './ui.js';

/** 総合の★ */
export function renderStars(box, state, onChange) {
  const draw = () =>
    box.replaceChildren(
      ...Array.from({ length: STAR_MAX }, (_, i) => {
        const n = i + 1;
        const on = state.stars != null && n <= state.stars;
        return el(
          'button',
          {
            type: 'button',
            class: `star${on ? ' on' : ''}`,
            'aria-label': `★${n}`,
            'aria-pressed': String(state.stars === n),
            onclick: () => {
              state.stars = state.stars === n ? null : n; // 同じ★をもう一度押すと消える
              draw();
              onChange();
            },
          },
          on ? '★' : '☆',
        );
      }),
      el('span', { class: 'star-count num' }, state.stars != null ? `${state.stars} / ${STAR_MAX}` : '未選択'),
    );
  draw();
}

/** 押すと付け外しできるチップの並び */
function checkChips(box, values, picked, onToggle) {
  box.replaceChildren(
    ...values.map((t) =>
      el(
        'label',
        { class: 'chip' },
        el('input', { type: 'checkbox', checked: picked.includes(t), onchange: (e) => onToggle(t, e.target.checked) }),
        el('span', {}, t),
      ),
    ),
  );
}

/** 一言タグ */
export function renderTags(box, state, onChange) {
  checkChips(box, QUICK_TAGS, state.tags, (t, on) => {
    state.tags = on ? [...state.tags, t] : state.tags.filter((x) => x !== t);
    onChange();
  });
}

/** ちょうど良さ（JAR）の5段階 */
export function renderJar(box, state, onChange) {
  const draw = () =>
    box.replaceChildren(
      ...JAR_ATTRS.map((a) => {
        const cur = state.jar[a.key];
        return el(
          'div',
          { class: 'jar-row', role: 'group', 'aria-label': a.label },
          el('div', { class: 'jar-label' }, el('strong', {}, a.label), el('span', { class: 'muted' }, cur == null ? '未回答' : a.words[cur + 2])),
          el(
            'div',
            { class: 'seg5' },
            ...a.words.map((w, i) => {
              const v = i - 2;
              return el(
                'button',
                {
                  type: 'button',
                  class: `seg${v === 0 ? ' just' : ''}`,
                  'aria-pressed': String(cur === v),
                  onclick: () => {
                    state.jar[a.key] = cur === v ? null : v; // 同じボタンをもう一度押すと未回答に戻る
                    draw();
                    onChange();
                  },
                },
                w,
              );
            }),
          ),
        );
      }),
    );
  draw();
}

/** 詳細評価（B3）：項目ごとに強さ（0〜15のスライダー）と好み（1〜9のボタン） */
export function renderDetail(box, state, onChange, countNode = null) {
  const mid = Math.round(INTENSITY_MAX / 2);
  const setIntensity = (key, v) => {
    state.intensity[key] = v == null ? null : Math.max(0, Math.min(INTENSITY_MAX, v));
    draw();
    onChange();
  };
  const draw = () => {
    if (countNode) {
      const n = detailAnsweredCount(state);
      countNode.textContent = n ? `${n}項目` : '';
    }
    box.replaceChildren(
      ...DETAIL_ATTRS.map((a) => {
        const i = state.intensity[a.key];
        const l = state.liking[a.key];
        const status = [i != null ? `強さ ${i}` : '', l != null ? `好み ${l}（${LIKING_WORDS[l - 1]}）` : ''].filter(Boolean).join('・') || '未回答';
        return el(
          'div',
          { class: 'detail-row', role: 'group', 'aria-label': a.label },
          el(
            'div',
            { class: 'jar-label' },
            el('strong', {}, a.label),
            el('span', { class: 'muted small' }, status),
            i != null || l != null
              ? el(
                  'button',
                  {
                    type: 'button',
                    class: 'link-btn small',
                    onclick: () => {
                      state.intensity[a.key] = null;
                      state.liking[a.key] = null;
                      draw();
                      onChange();
                    },
                  },
                  '消す',
                )
              : '',
          ),
          el(
            'div',
            { class: 'intensity-line' },
            el('span', { class: 'detail-kind muted small' }, '強さ'),
            el('button', { type: 'button', class: 'step-btn', 'aria-label': `${a.label}の強さを下げる`, onclick: () => setIntensity(a.key, (i ?? mid) - 1) }, '−'),
            el('input', {
              type: 'range',
              min: '0',
              max: String(INTENSITY_MAX),
              step: '1',
              value: String(i ?? mid),
              class: i == null ? 'unset' : '',
              'aria-label': `${a.label}の強さ（0〜${INTENSITY_MAX}）`,
              oninput: (e) => {
                state.intensity[a.key] = Number(e.target.value);
                e.target.classList.remove('unset');
                e.target.closest('.detail-row').querySelector('.intensity-value').textContent = e.target.value;
              },
              onchange: () => {
                draw();
                onChange();
              },
            }),
            el('button', { type: 'button', class: 'step-btn', 'aria-label': `${a.label}の強さを上げる`, onclick: () => setIntensity(a.key, (i ?? mid) + 1) }, '＋'),
            el('span', { class: 'intensity-value num' }, i == null ? '—' : String(i)),
          ),
          el(
            'div',
            { class: 'liking-line' },
            el('span', { class: 'detail-kind muted small' }, '好み'),
            el(
              'div',
              { class: 'seg9' },
              ...LIKING_WORDS.map((w, idx) => {
                const v = idx + 1;
                return el(
                  'button',
                  {
                    type: 'button',
                    class: `seg${v === 5 ? ' just' : ''}`,
                    'aria-pressed': String(l === v),
                    'aria-label': `好み ${v}（${w}）`,
                    onclick: () => {
                      state.liking[a.key] = l === v ? null : v;
                      draw();
                      onChange();
                    },
                  },
                  String(v),
                );
              }),
            ),
          ),
        );
      }),
    );
  };
  draw();
}

/** 香味（B4）：選んだ香味・9カテゴリ・開いたカテゴリの語 */
export function renderFlavors(box, state, onChange) {
  let openKey = null;
  const toggle = (path) => {
    state.flavors = toggleFlavor(state.flavors, path);
    draw();
    onChange();
  };
  const draw = () => {
    const picked = state.flavors.length
      ? el(
          'div',
          { class: 'flavor-picked' },
          ...state.flavors.map((p) =>
            el('button', { type: 'button', class: 'picked-chip', 'aria-label': `${flavorLabel(p)}を外す`, onclick: () => toggle(p) }, `${flavorLabel(p)} ×`),
          ),
        )
      : el('p', { class: 'muted small' }, 'まだ選んでいません');
    const cats = el(
      'div',
      { class: 'flavor-cats' },
      ...FLAVOR_WHEEL.map((c) => {
        const n = countInCategory(state.flavors, c.key);
        return el(
          'button',
          {
            type: 'button',
            class: `flavor-cat${n ? ' has' : ''}`,
            'aria-expanded': String(openKey === c.key),
            onclick: () => {
              openKey = openKey === c.key ? null : c.key;
              draw();
            },
          },
          c.label,
          n ? el('span', { class: 'flavor-count num' }, String(n)) : '',
        );
      }),
    );
    const open = FLAVOR_WHEEL.find((c) => c.key === openKey);
    const words = open
      ? el(
          'div',
          { class: 'flavor-words' },
          el('p', { class: 'muted small' }, `${open.label}：細かく分からなければ「${open.label}」だけを選びます`),
          el(
            'div',
            { class: 'chips' },
            ...[{ path: open.key, label: open.label }, ...open.words.map((w) => ({ path: `${open.key}/${w.key}`, label: w.label }))].map((x) =>
              el(
                'label',
                { class: 'chip' },
                el('input', { type: 'checkbox', checked: state.flavors.includes(x.path), onchange: () => toggle(x.path) }),
                el('span', {}, x.label),
              ),
            ),
          ),
        )
      : '';
    box.replaceChildren(picked, cats, words);
  };
  draw();
}

/** 雑味タグ（B4） */
export function renderDefects(box, state, onChange) {
  checkChips(box, DEFECT_TAGS, state.defects, (t, on) => {
    state.defects = on ? [...state.defects, t] : state.defects.filter((x) => x !== t);
    onChange();
  });
}
