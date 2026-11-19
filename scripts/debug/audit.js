// 総点検（2-8）の一斉点検。アプリには含めない（scripts/ は sw.js の一覧に入らない）。
// Playwright からは scripts/debug/matrix.js が inspect・pagesWithIds を使う（設定を組み合わせて回す）。
// Browserペインで、点検用のポート（8082〜8086）のどれかの画面を開き、javascript_tool で次を実行する：
//   const m = await import('/scripts/debug/audit.js?' + Date.now()); m.start({ label: 'demo-light' });
//   （数十秒〜数分かかる。終わったかは window.__audit.status、結果は m.summary() か window.__audit.rows）
// ダークの点検は、先に resize_window の colorScheme: 'dark' で切り替えてから label を変えて回す。
// 1画面ずつ iframe で開き（幅ごとに同時に開く）、表示が落ち着いてから次を数える：
//   画面のエラー／横のはみ出し／文字の切れ／44px未満の押す所／小さすぎる文字／色の差が足りない文字／
//   「読み込み中」のまま／「undefined」「NaN」「null」などの表示

export const VIEWPORTS = [
  { name: '320', w: 320, h: 640 },
  { name: '375', w: 375, h: 812 },
  { name: '768', w: 768, h: 1024 },
  { name: 'PC', w: 1280, h: 800 },
  { name: '横812', w: 812, h: 375 },
];

export const PAGES = [
  'index.html', 'today.html', 'beans.html', 'bean-edit.html', 'recipes.html', 'recipe-edit.html', 'brew.html',
  'equipment.html', 'equipment-edit.html', 'analysis.html', 'analysis.html?demo=1', 'brew-chart.html', 'calendar.html',
  'factors.html', 'profile.html', 'dialin-history.html', 'cost.html', 'shopping.html', 'wishlist.html', 'shops.html', 'order-import.html',
  'compare.html', 'optimize.html', 'ai.html', 'report.html', 'share.html', 'scan.html', 'recipe-card.html', 'more.html', 'data.html',
  'storage-test.html', 'tasting.html', 'weather.html', 'life.html', 'life.html?demo=1',
  'repro.html', 'repro.html?demo=1', 'aging.html', 'aging.html?demo=1', 'aging.html?bean=no-such-id', 'glossary.html', 'glossary.html#t-tds', 'gift.html',
  'wrapped.html', 'wrapped.html?demo=1', 'wrapped.html?year=2025',
];

/** 記録があれば、IDの要る画面も足す（いちばん新しい豆・レシピ・抽出・器具・飲み比べ） */
export async function pagesWithIds({ every = false } = {}) {
  const db = await import('/js/db.js');
  const d = db.openDb();
  const all = await db.readAll(d);
  d.close();
  const alive = (t) => (all[t] ?? []).filter((r) => r.deletedAt == null);
  const newest = (rows, k = 'updatedAt') => [...rows].sort((a, b) => String(b[k]).localeCompare(String(a[k])))[0];
  const out = [...PAGES];
  const bean = newest(alive('beans').filter((b) => b.status !== 'finished')) ?? newest(alive('beans'));
  const recipe = newest(alive('recipes'));
  const brew = newest(alive('brews'), 'at');
  const eq = newest(alive('equipment'));
  const exp = newest(alive('experiments').filter((e) => e.kind !== 'optimize'));
  if (bean) out.push(`aging.html?bean=${bean.id}`);
  if (bean) out.push(`bean.html?id=${bean.id}`, `bean-edit.html?id=${bean.id}`, `dialin-history.html?bean=${bean.id}`, `brew.html?bean=${bean.id}`, `ai.html?bean=${bean.id}`, `share.html?bean=${bean.id}`, `recipe-card.html?bean=${bean.id}&canister=1`);
  if (recipe) out.push(`recipe-edit.html?id=${recipe.id}`, `recipe-card.html?recipe=${recipe.id}`, `share.html?recipe=${recipe.id}`, `brew.html?recipe=${recipe.id}`);
  if (brew) out.push(`tasting.html?brew=${brew.id}`, `brew.html?brew=${brew.id}`);
  if (eq) out.push(`equipment-edit.html?id=${eq.id}`);
  if (exp) out.push(`compare.html?id=${exp.id}`);
  const opt = newest(alive('experiments').filter((e) => e.kind === 'optimize'));
  if (opt) out.push(`optimize.html?id=${opt.id}`);
  const wish = newest(alive('wishlist'));
  if (wish) out.push(`bean-edit.html?wish=${wish.id}&roast=シティ`);
  out.push('bean-edit.html?wish=no-such-id');
  if (bean) out.push(`optimize.html?bean=${bean.id}`, `compare.html?bean=${bean.id}`, `compare.html?new=triangle`);
  // 削除した豆のページ（意地悪のデータ）
  const deadBean = (all.beans ?? []).find((b) => b.deletedAt != null);
  if (deadBean) out.push(`bean.html?id=${deadBean.id}`);
  out.push('bean.html?id=no-such-id', 'tasting.html?brew=no-such-id', 'brew.html?bean=no-such-id', 'recipe-edit.html?id=no-such-id', 'compare.html?id=no-such-id', 'optimize.html?id=no-such-id');
  // every：全部の豆・抽出・レシピ・飲み比べのページ（意地悪のデータ用。削除済みも含む）
  if (every) {
    for (const b of all.beans ?? []) out.push(`aging.html?bean=${b.id}`);
    for (const b of all.beans ?? []) out.push(`bean.html?id=${b.id}`, `brew.html?bean=${b.id}`, `dialin-history.html?bean=${b.id}`);
    for (const b of all.brews ?? []) out.push(`tasting.html?brew=${b.id}`);
    for (const r of all.recipes ?? []) out.push(`recipe-edit.html?id=${r.id}`, `recipe-card.html?recipe=${r.id}`);
    for (const e of all.experiments ?? []) out.push(`compare.html?id=${e.id}`);
  }
  return out;
}

// ---- 色の計算 ----
const ctx = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c.getContext('2d', { willReadFrequently: true });
})();
/** CSS の色を [r,g,b,a]（0〜255、a は 0〜1）に直す（oklch や color-mix でも canvas に描かせて読む） */
function rgba(color) {
  if (!color || color === 'transparent') return [0, 0, 0, 0];
  const m = color.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}
const lum = ([r, g, b]) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const blend = (top, bottom) => {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
};
function effectiveBg(el, win) {
  const layers = [];
  for (let e = el; e; e = e.parentElement) {
    const cs = win.getComputedStyle(e);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // 画像や模様の上は数えない
    const c = rgba(cs.backgroundColor);
    if (c[3] > 0) {
      layers.push(c);
      if (c[3] >= 1) break;
    }
  }
  let bg = [255, 255, 255, 1];
  for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
  return bg;
}
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// ---- 1画面の点検 ----
const label = (el) => {
  const t = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  const id = el.id ? `#${el.id}` : el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : '';
  return `${el.tagName.toLowerCase()}${id}${t ? `「${t}」` : ''}`;
};
const visible = (el, win) => {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 1 || r.height <= 1) return false; // 見えない入力（ファイル選択など）や読み上げ用の文字
  if (el.closest('.visually-hidden, .sr-only')) return false;
  const cs = win.getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
};
const uniq = (arr, n = 6) => [...new Set(arr)].slice(0, n);

export function inspect(win, vp) {
  const doc = win.document;
  const body = doc.body;
  const out = {};
  if (!body) return { error: 'bodyがない' };
  // 下のタブの位置（D-184）：画面のいちばん下にあること。ページ全体はスクロールしないこと
  const tab = doc.querySelector('nav.tabbar');
  if (tab && visible(tab, win)) {
    const r = tab.getBoundingClientRect();
    if (Math.abs(r.bottom - win.innerHeight) > 1) out.tabbarOff = { bottom: Math.round(r.bottom), innerHeight: win.innerHeight };
  }
  if (doc.documentElement.scrollHeight > win.innerHeight + 1 && win.getComputedStyle(doc.documentElement).overflowY === 'hidden' && win.scrollY !== 0) out.docScrolled = win.scrollY;
  // 横のはみ出し（中身の箱 main の中のはみ出しも数える。D-184 でページ全体はスクロールしないため）
  const mainEl = doc.querySelector('main');
  const sw = Math.max(doc.documentElement.scrollWidth, mainEl ? mainEl.scrollWidth - mainEl.clientWidth + vp.w : 0);
  if (sw > vp.w + 1) {
    const culprits = [...body.querySelectorAll('*')]
      .filter((e) => visible(e, win) && e.getBoundingClientRect().right > vp.w + 1)
      .filter((e) => !e.closest('[hidden]'));
    // いちばん内側のものを出す
    const inner = culprits.filter((e) => !culprits.some((c) => c !== e && e.contains(c)));
    out.overflowX = { scrollWidth: sw, els: uniq(inner.map(label)) };
  }
  // 文字の切れ（はみ出しを隠している・省略記号）
  const clipped = [...body.querySelectorAll('*')].filter((e) => {
    if (!visible(e, win) || !e.textContent.trim()) return false;
    const cs = win.getComputedStyle(e);
    const hides = ['hidden', 'clip'].includes(cs.overflowX) || cs.textOverflow === 'ellipsis';
    return hides && e.scrollWidth > e.clientWidth + 1 && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName);
  });
  if (clipped.length) out.clipped = uniq(clipped.map(label));
  // 44px未満の押す所（文の中のリンクは除く）
  const taps = [...body.querySelectorAll('button, a.btn, a.link-more, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), [role=button], summary, label.chip, .chip, nav a, .tabbar a')]
    .filter((e) => visible(e, win))
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return r.height < 44 || (e.tagName !== 'INPUT' && e.tagName !== 'SELECT' && r.width < 44);
    });
  if (taps.length) out.smallTap = { n: taps.length, els: uniq(taps.map((e) => `${label(e)} ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`), 8) };
  // 文字（文字を直接持つ要素）
  const textEls = [...body.querySelectorAll('*')].filter((e) => visible(e, win) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const small = textEls.filter((e) => parseFloat(win.getComputedStyle(e).fontSize) < 12);
  if (small.length) out.smallText = { n: small.length, els: uniq(small.map((e) => `${label(e)} ${win.getComputedStyle(e).fontSize}`)) };
  const low = [];
  for (const e of textEls) {
    if (e.closest('svg, canvas')) continue;
    const cs = win.getComputedStyle(e);
    const bg = effectiveBg(e, win);
    if (!bg) continue;
    const fg = blend(rgba(cs.color), bg);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const disabled = e.closest('button:disabled, input:disabled, [aria-disabled=true]');
    const r = ratio(fg, bg);
    if (r < need && !disabled) low.push(`${label(e)} ${r.toFixed(2)}`);
  }
  if (low.length) out.lowContrast = { n: low.length, els: uniq(low) };
  // 文字の中身
  const text = body.innerText;
  if (/読み込み中/.test(text)) out.loading = true;
  const bad = text.match(/(^|[^A-Za-z])(undefined|NaN|null|\[object Object\]|Invalid Date)(?![A-Za-z])/g);
  if (bad) {
    const lines = text.split('\n').filter((l) => /(^|[^A-Za-z])(undefined|NaN|null|\[object Object\]|Invalid Date)(?![A-Za-z])/.test(l));
    out.badText = uniq(lines.map((l) => l.trim().slice(0, 60)));
  }
  // 入力欄の値
  const badVals = [...body.querySelectorAll('input, textarea')].filter((e) => /^(undefined|NaN|null)$/.test(e.value));
  if (badVals.length) out.badValue = uniq(badVals.map(label));
  return out;
}

/** 1画面を1つの幅で開いて点検する */
function runOne(page, vp, settleMs) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = `position:fixed;left:-${vp.w + 50}px;top:0;width:${vp.w}px;height:${vp.h}px;border:0;`;
    const errors = [];
    let hooked = null;
    const hook = () => {
      const w = frame.contentWindow;
      if (!w || hooked === w.document) return;
      try {
        if (w.location.href === 'about:blank') return;
      } catch {
        return;
      }
      hooked = w.document;
      w.addEventListener('error', (e) => {
        if (e.target && e.target !== w && e.target.tagName) errors.push(`読み込めない：${e.target.src || e.target.href || e.target.tagName}`);
        else errors.push(`${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`);
      }, true);
      w.addEventListener('unhandledrejection', (e) => errors.push(`処理の失敗：${e.reason?.message ?? e.reason}`));
      const ce = w.console.error.bind(w.console);
      w.console.error = (...a) => {
        errors.push(`console.error：${a.map((x) => x?.message ?? String(x)).join(' ').slice(0, 160)}`);
        ce(...a);
      };
      // 確認のダイアログや画面を移る動きで止まらないように
      w.alert = () => {};
      w.confirm = () => false;
      w.prompt = () => null;
    };
    const timer = setInterval(hook, 2);
    frame.addEventListener('load', () => {
      hook();
      setTimeout(() => {
        clearInterval(timer);
        let result;
        try {
          const w = frame.contentWindow;
          const moved = !w.location.href.endsWith(page) ? w.location.pathname.split('/').pop() + w.location.search : null;
          result = { ...inspect(w, vp), ...(moved ? { movedTo: moved } : {}) };
        } catch (e) {
          result = { error: `点検できない：${e.message}` };
        }
        if (errors.length) result.errors = uniq(errors, 8);
        frame.remove();
        resolve(result);
      }, settleMs);
    });
    frame.src = `/${page}`;
    document.body.appendChild(frame);
  });
}

/**
 * 点検を始める（終わるのを待たずに返る）
 * @param {{label?:string, pages?:string[], viewports?:string[], settleMs?:number, every?:boolean}} opts
 */
export function start({ label: runLabel = 'run', pages = null, viewports = null, settleMs = 1800, every = false } = {}) {
  const state = { label: runLabel, status: 'running', done: 0, total: 0, rows: [], startedAt: Date.now() };
  window.__audit = state;
  (async () => {
    try {
      const list = [...new Set(pages ?? (await pagesWithIds({ every })))];
      const vps = VIEWPORTS.filter((v) => !viewports || viewports.includes(v.name));
      state.total = list.length * vps.length;
      for (const page of list) {
        const results = await Promise.all(vps.map((vp) => runOne(page, vp, settleMs)));
        results.forEach((r, i) => state.rows.push({ page, vp: vps[i].name, ...r }));
        state.done += vps.length;
      }
      state.status = 'done';
    } catch (e) {
      state.status = `failed: ${e.message}`;
    }
    state.sec = Math.round((Date.now() - state.startedAt) / 1000);
  })();
  return `started ${runLabel}`;
}

/**
 * 結果を、問題ごとにまとめて返す（幅ごとの違いは1行にまとめる）
 * { 問題の種類: [{ page, vps, detail }] }
 */
export function summary(rows = window.__audit?.rows ?? []) {
  const KEYS = ['errors', 'error', 'overflowX', 'clipped', 'loading', 'badText', 'badValue', 'smallText', 'lowContrast', 'smallTap', 'tabbarOff', 'docScrolled', 'movedTo'];
  const out = {};
  for (const k of KEYS) {
    const map = new Map();
    for (const r of rows) {
      if (r[k] == null) continue;
      const detail = JSON.stringify(k === 'overflowX' ? r[k].els : k === 'smallTap' || k === 'smallText' || k === 'lowContrast' ? r[k].els : r[k]);
      const key = `${r.page.replace(/=[0-9a-f-]{36}/g, '=ID')}|${detail}`;
      if (!map.has(key)) map.set(key, { page: r.page.replace(/=[0-9a-f-]{36}/g, '=ID'), vps: [], detail: JSON.parse(detail) });
      map.get(key).vps.push(r.vp);
    }
    if (map.size) out[k] = [...map.values()];
  }
  return out;
}
