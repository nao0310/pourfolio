// お知らせのカードを閉じたことの記憶（純粋関数、2-8 の2番）
// 閉じたカードは、カードごとに決めた時期までもう出さない。覚えるのはこの端末の中だけ（書き出しには入れない）。
// 記憶の形：{ [キー]: { at: ISO日時, until: ISO日時|null } }。until が null なら「このキーではもう出さない」。

/** 期限なし（そのキーではもう出さない）のものを、何日で忘れるか（記憶が増え続けないように） */
export const FORGET_DAYS = 30;

/**
 * カードごとの「閉じたあと、いつまた出すか」
 * - days：その日数たったらまた出す
 * - days が null：同じキー（その杯・その下書き・その中身）ではもう出さない。中身が変わるとキーが変わるので、また出る
 */
export const DISMISS_RULES = Object.freeze({
  cool: { days: null, label: 'この杯ではもう出しません' },
  unrated: { days: null, label: 'この杯ではもう出しません' },
  resume: { days: null, label: 'この途中の抽出ではもう出しません（下書きは残っています）' },
  compare: { days: 1, label: '明日また出します' },
  alert: { days: null, label: '在庫の様子が変わったらまた出します' },
  restock: { days: null, label: '注文の目安が変わったらまた出します' },
  backup: { days: 7, label: '7日後にまた出します' },
  install: { days: 7, label: '7日後にまた出します' },
  autosave: { days: 1, label: '明日また出します' },
  init: { days: null, label: 'この豆ではもう出しません' },
});

/**
 * カードのキー。kind は DISMISS_RULES の名前、part はその杯のIDや中身の目印（なくてもよい）
 * @param {string} kind
 * @param {string|number|null} [part]
 */
export function dismissKey(kind, part = null) {
  if (!Object.hasOwn(DISMISS_RULES, kind)) throw new Error(`知らないカードです：${kind}`);
  return part == null || part === '' ? kind : `${kind}:${part}`;
}

const ms = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};
const toDate = (now) => (now instanceof Date ? now : new Date(now));

/** そのキーのカードを、今は閉じたままにするか */
export function isDismissed(memo, key, now = new Date()) {
  const e = memo?.[key];
  if (!e || typeof e !== 'object') return false;
  if (e.until == null) return true;
  const until = ms(e.until);
  return until != null && toDate(now).getTime() < until;
}

/**
 * 閉じたことを覚えた、新しい記憶を返す（元の記憶は変えない）
 * @param {object} memo
 * @param {string} key dismissKey の値
 * @param {Date|string|number} [now]
 */
export function dismiss(memo, key, now = new Date()) {
  const kind = key.split(':')[0];
  const rule = DISMISS_RULES[kind];
  if (!rule) throw new Error(`知らないカードです：${kind}`);
  const at = toDate(now);
  const until = rule.days == null ? null : new Date(at.getTime() + rule.days * 86400000).toISOString();
  return { ...prune(memo, at), [key]: { at: at.toISOString(), until } };
}

/** 期限の過ぎた記憶と、FORGET_DAYS より古い「もう出さない」の記憶を捨てる */
export function prune(memo, now = new Date()) {
  const t = toDate(now).getTime();
  const out = {};
  for (const [key, e] of Object.entries(memo ?? {})) {
    if (!e || typeof e !== 'object') continue;
    if (e.until != null) {
      const until = ms(e.until);
      if (until != null && t < until) out[key] = e;
      continue;
    }
    const at = ms(e.at);
    if (at != null && t - at < FORGET_DAYS * 86400000) out[key] = e;
  }
  return out;
}
