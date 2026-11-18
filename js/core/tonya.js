// 珈琲問屋の文章の読み取り（純粋関数）
// - 商品ページ（X28）：Safariで「すべてを選択」→コピーした文章から、銘柄・産地・精製・価格などを振り分ける
// - 注文確認メール（X29）：本文から、注文番号・注文日・送料と、コーヒー豆の品目（銘柄・焙煎度・生豆時の重さ・数量・価格）を取り出す
// 名前・住所・電話番号などは読まない。読めない項目は空のままにし、止まらない。

import { ROAST_LEVELS } from './roast.js';

/** 全角英数・全角スペースを直し、行に分ける */
function lines(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[\t ]+/g, ' ').trim());
}

const toInt = (s) => {
  const n = Number(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** 精製方法の書き方の違いを、アプリの選択肢にそろえる（合わなければそのまま） */
export function normalizeProcess(text) {
  const t = String(text ?? '').normalize('NFKC').trim();
  if (!t) return '';
  // 「非水洗」「パルプドナチュラル」「アナエロビック・ナチュラル」を取り違えないよう、細かい書き方から先に見る
  if (/アナエロ|嫌気/.test(t)) return 'アナエロビック';
  if (/ハニー|パルプド/.test(t)) return 'ハニー';
  if (/スマトラ/.test(t)) return 'スマトラ式';
  if (/ナチュラル|非水洗|乾燥式/.test(t)) return 'ナチュラル';
  if (/ウォッシュ[トド]|水洗/.test(t)) return 'ウォッシュト';
  return t;
}

/** 「ミディアム(標準)」「ハイ(+20秒)」「ミディアムロースト」から8段階の表記を取り出す（生豆・不明は ''） */
export function roastFromText(text) {
  const t = String(text ?? '').normalize('NFKC');
  // 長い名前から先に見る（「フルシティ」を「シティ」と読まないため）
  const found = [...ROAST_LEVELS].sort((a, b) => b.length - a.length).find((lv) => t.includes(lv));
  return found ?? '';
}

/** 「ラベル：値」の行の値（行頭がラベルのものだけ。レビューの中の文は拾わない） */
function labeled(ls, labels) {
  for (const l of ls) {
    for (const label of labels) {
      const m = new RegExp(`^${label}\\s*[:：]\\s*(.+)$`).exec(l);
      if (m) return m[1].trim();
    }
  }
  return '';
}

/**
 * 商品ページの文章を読む
 * @param {string} text
 * @returns {{found:boolean, name:string, productCode:string, country:string, region:string, farm:string, variety:string, process:string,
 *   grade:string, altitude:string, roastLevel:string, labelWeightG:number|null, labelWeightBasis:'green', priceJpy:number|null,
 *   priceTable:{g:number, priceJpy:number}[], flavorNotes:string}}
 */
export function parseProductText(text) {
  const ls = lines(text);
  // レビューの欄より後ろは「商品情報」の表まで読まない（レビューの中に「産地：」などが書かれることがあるため）
  const reviewAt = ls.findIndex((l) => /^USER REVIEW|^ユーザーレビュー/.test(l));
  const infoAt = ls.findIndex((l, i) => i > reviewAt && reviewAt >= 0 && l === '商品情報');
  const body = reviewAt >= 0 ? [...ls.slice(0, reviewAt), ...(infoAt >= 0 ? ls.slice(infoAt) : [])] : ls;

  // 銘柄：最後のパンくず（「ホーム > …」）の次の行
  let name = '';
  const lastCrumb = body.reduce((at, l, i) => (/^ホーム\s*>/.test(l) ? i : at), -1);
  if (lastCrumb >= 0) name = body.slice(lastCrumb + 1).find((l) => l) ?? '';
  // 見つからなければ、評価（「4.5」の次が「（1262）」）の直前の行
  if (!name) {
    const i = body.findIndex((l, k) => /^\d\.\d$/.test(l) && /^\(\d[\d,]*\)$/.test(body[k + 1] ?? ''));
    if (i > 0) name = body[i - 1];
  }

  const productCode = labeled(body, ['商品コード']) || (/^商品コード\s+(\S+)$/.exec(body.find((l) => /^商品コード\s+\S+$/.test(l)) ?? '')?.[1] ?? '');

  const country = labeled(body, ['生産国', '国名']);
  const origin = labeled(body, ['産地', '生産地']);
  const region = labeled(body, ['地域', '生産地域']) || (origin && origin !== country ? origin : '');
  const farm = labeled(body, ['農園', '農園名', '生産者']);
  const variety = labeled(body, ['品種']);
  const process = normalizeProcess(labeled(body, ['精製方法', '精製', '精選方法', '精選プロセス']));
  const grade = labeled(body, ['規格', 'グレード']);
  const altitude = labeled(body, ['標高', '栽培標高']);

  // 焙煎度：店の標準（「標準の【ミディアムロースト】」）。注文で選んだ焼き方は分からないので目安
  const stdLine = body.find((l) => /標準の\s*【[^】]+】/.test(l)) ?? '';
  const roastLevel = roastFromText(/標準の\s*【([^】]+)】/.exec(stdLine)?.[1] ?? '');

  // 価格：「720円1,280円1,740円…」は 100g・200g・300g… の値段（生豆時）
  let priceTable = [];
  const tableLine = body.find((l) => /^(\d[\d,]*円){2,}$/.test(l.replace(/\s/g, '')));
  if (tableLine) {
    priceTable = [...tableLine.replace(/\s/g, '').matchAll(/(\d[\d,]*)円/g)].map((m, i) => ({ g: (i + 1) * 100, priceJpy: toInt(m[1]) }));
  }
  const perLine = body.findIndex((l) => /^\(生豆時100gあたり\)$/.test(l));
  const per100 = perLine >= 0 ? toInt(/^(\d[\d,]*)円/.exec(body[perLine + 1] ?? '')?.[1]) : null;
  const first = priceTable[0] ?? (per100 != null ? { g: 100, priceJpy: per100 } : null);

  // 店の短い紹介：「掲載日：」の次の行
  const postedAt = body.findIndex((l) => /^掲載日\s*[:：]/.test(l));
  let flavorNotes = postedAt >= 0 ? body[postedAt + 1] ?? '' : '';
  if (/^ポイント|^お得な|^\(生豆時/.test(flavorNotes)) flavorNotes = '';

  const found = Boolean(name && (country || process || first || productCode));
  return {
    found,
    name: found ? name : '',
    productCode,
    country,
    region,
    farm,
    variety,
    process,
    grade,
    altitude,
    roastLevel,
    labelWeightG: first?.g ?? null,
    labelWeightBasis: 'green',
    priceJpy: first?.priceJpy ?? null,
    priceTable,
    flavorNotes,
  };
}

/** 商品ページから豆のメモに入れる文（規格・標高） */
export function productMemo(p) {
  return [p.grade && `規格：${p.grade}`, p.altitude && `標高：${p.altitude}`].filter(Boolean).join('　');
}

/** 品目名から「限定品」などの頭の飾りを除き、空白をそろえる */
function cleanItemName(name) {
  return name
    .replace(/^(限定品|数量限定|期間限定|新商品|NEW|【[^】]*】)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 注文確認メールを読む
 * @param {string} text
 * @returns {{found:boolean, orderNo:string, orderDate:string|null, shippingJpy:number|null,
 *   items:{name:string, productCode:string, roastLevel:string, isGreen:boolean, labelWeightG:number|null, labelWeightBasis:'green'|'roasted', qty:number, priceJpy:number|null, process:string, farm:string}[],
 *   others:{name:string, qty:number, priceJpy:number|null}[]}}
 */
export function parseOrderEmail(text) {
  const ls = lines(text);
  const orderNo = /^\[注文番号\]\s*(\S+)/.exec(ls.find((l) => /^\[注文番号\]/.test(l)) ?? '')?.[1]
    ?? /^★?注文番号\s*[:：]\s*(\S+)/.exec(ls.find((l) => /^★?注文番号\s*[:：]/.test(l)) ?? '')?.[1]
    ?? '';
  const dateLine = ls.find((l) => /^(\[ご注文日時\]|★?ご注文日時\s*[:：]|\[注文日\])/.test(l)) ?? '';
  const dm = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(dateLine);
  const orderDate = dm ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}` : null;
  const shipLine = ls.find((l) => /^送料\s*[:：]/.test(l)) ?? '';
  const shippingJpy = toInt(/([\d,]+)\s*\(?円/.exec(shipLine)?.[1]);

  // [商品] から「小計」までを、品目ごとに分ける（区切りは「----------」）
  const start = ls.findIndex((l) => l === '[商品]');
  const end = ls.findIndex((l, i) => i > start && /^小計\s*[:：]/.test(l));
  const block = start >= 0 ? ls.slice(start + 1, end > start ? end : undefined) : [];
  const chunks = [];
  let cur = [];
  for (const l of block) {
    if (/^-{3,}$/.test(l)) {
      if (cur.length) chunks.push(cur);
      cur = [];
    } else if (l) cur.push(l);
  }
  if (cur.length) chunks.push(cur);

  const items = [];
  const others = [];
  for (const c of chunks) {
    const head = c[0] ?? '';
    // 「(2-100)ガテマラSHB(100g (生豆時))」
    const hm = /^\((\d+)(?:-\d+)?\)\s*(.+?)\s*(?:\((\d+(?:\.\d+)?)\s*(?:g|グラム)\s*(?:\(([^)]*)\))?\))?$/.exec(head);
    const rawName = hm?.[2] ?? head;
    const productCode = hm?.[1] ?? '';
    const grams = hm?.[3] != null ? Number(hm[3]) : null;
    const basisText = hm?.[4] ?? '';
    const roastText = /^焙煎度合\s*[:：]\s*(.+)$/.exec(c.find((l) => /^焙煎度合\s*[:：]/.test(l)) ?? '')?.[1] ?? '';
    const pm = /^価格\s*([\d,]+)\s*\(?円\)?\s*[x×]\s*(\d+)/.exec(c.find((l) => /^価格/.test(l)) ?? '');
    const priceJpy = toInt(pm?.[1]);
    const qty = pm ? Number(pm[2]) : 1;
    const isCoffee = Boolean(roastText) || /生豆時/.test(basisText);
    if (!isCoffee) {
      others.push({ name: cleanItemName(rawName), qty, priceJpy });
      continue;
    }
    const name = cleanItemName(rawName);
    items.push({
      name,
      productCode,
      roastLevel: roastFromText(roastText),
      isGreen: /^生豆/.test(roastText.trim()),
      labelWeightG: grams,
      labelWeightBasis: /焙煎後/.test(basisText) ? 'roasted' : 'green',
      qty,
      priceJpy,
      process: /ウォッシュ|ナチュラル|ハニー|スマトラ|アナエロ|パルプド/.test(name) ? normalizeProcess(name) : '',
      farm: name.split(' ').find((w) => /農園$/.test(w)) ?? '',
    });
  }
  return { found: items.length > 0, orderNo, orderDate, shippingJpy, items, others };
}
