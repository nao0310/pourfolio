// AI相談テキスト（F5、spec 6.7）：記録の要約と質問文を1つのテキストにする。AIの答えから提案レシピを読み取る（純粋関数）
// テキストは自分でコピーして手元のチャットAIに貼る。アプリから外へは送らない（API料金ゼロ）。
// メモ（自由に書いた文）は個人的なことが入りやすいので入れない。

import { pickTasting, JAR_ATTRS, jarWord } from './tastings.js';
import { ratioOf, formatSec } from './recipes.js';
import { localYmd } from './format.js';
import { preferenceBy } from './preference.js';
import { normalizeOverrides, isIced } from './plan-adjust.js';
import { originText } from './beans.js';

const alive = (r) => r && r.deletedAt == null;

/** 質問のテンプレ（spec 6.7） */
export const QUESTIONS = Object.freeze({
  next: { label: '次の1杯で何を変える？', text: '直近の記録から、次の1杯で何を変えるとよいですか？', recipe: true },
  bean: { label: 'この豆に合う淹れ方は？', text: '「{bean}」に合う淹れ方を教えてください。', recipe: true },
  buy: { label: '次に珈琲問屋で何を買う？', text: '私の好みから、次に珈琲問屋で買うとよい豆（産地・精製・焙煎度）を3つ挙げてください。焙煎度は珈琲問屋の8段階（ライト〜イタリアン）で答えてください。', recipe: false },
});

/** 要約に入れる杯の数 */
export const RECENT_N = 14;

/** 答えの形（取り込みで読む見出し） */
export const ANSWER_HEAD = '【提案レシピ】';
const ANSWER_FORMAT = [ANSWER_HEAD, '豆：（豆の名前）', '粉量：○g', '湯量：○g', '湯温：○℃', '挽き目：（私のグラインダーの目盛り）', '理由：（1〜2文）'].join('\n');

const cell = (v) => String(v ?? '').replaceAll('|', '／').replaceAll('\n', ' ').trim() || '—';

/** JARのちょうどでない項目「酸味やや強い・苦味やや弱い」 */
function jarText(jar) {
  if (!jar) return '';
  return JAR_ATTRS.filter((a) => jar[a.key] != null && jar[a.key] !== 0)
    .map((a) => `${a.label}${jarWord(a.key, jar[a.key])}`)
    .join('・');
}

/**
 * 直近の抽出の要約表（新しい順）
 * @returns {string[]} 表の行（見出しを含む）
 */
export function brewTable({ brews = [], tastings = [], beans = [], equipment = [], n = RECENT_N, beanId = null }) {
  const beanOf = new Map(beans.map((b) => [b.id, b]));
  const eqName = (id) => equipment.find((e) => e.id === id)?.name ?? '';
  const list = brews
    .filter((b) => alive(b) && (!beanId || b.beanId === beanId))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, n);
  const head = ['| 日付 | 豆 | 焙煎度 | 焙煎後 | 粉 | 湯 | 比率 | 湯温 | 挽き目 | 時間 | ★ | ちょうど良さ | 一言 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  const rows = list.map((b) => {
    const a = b.actual ?? {};
    const bean = beanOf.get(b.beanId);
    const t = pickTasting(tastings, b.id);
    const grind = a.grind?.setting ? `${a.grind.setting}${eqName(a.grind.grinderId) ? `（${eqName(a.grind.grinderId)}）` : ''}` : '';
    const water = isIced(b) ? `${a.waterG}g＋氷${b.context.iceG}g` : a.waterG != null ? `${a.waterG}g` : '';
    return `| ${[
      localYmd(b.at),
      bean?.name,
      bean?.roastLevel,
      b.derived?.daysOffRoast != null ? `${b.derived.daysOffRoast}日` : '',
      a.doseG != null ? `${a.doseG}g` : '',
      water,
      isIced(b) ? `1:${ratioOf(a.doseG, a.waterG + b.context.iceG)}（氷込み）` : ratioOf(a.doseG, a.waterG) ? `1:${ratioOf(a.doseG, a.waterG)}` : '',
      a.tempC != null ? `${a.tempC}℃` : '',
      grind,
      a.totalSec ? formatSec(a.totalSec) : '',
      t?.stars != null ? `★${t.stars}` : '',
      jarText(t?.jar),
      (t?.tags ?? []).join('・'),
    ]
      .map(cell)
      .join(' | ')} |`;
  });
  return rows.length ? [...head, ...rows] : ['（まだ抽出の記録はありません）'];
}

/** 嗜好スコアの上位と下位（区分ごとに1行） */
export function preferenceLines({ brews = [], tastings = [], beans = [] }) {
  const beanOf = new Map(beans.map((b) => [b.id, b]));
  const rows = brews
    .filter(alive)
    .map((b) => ({ bean: beanOf.get(b.beanId) ?? null, stars: pickTasting(tastings, b.id)?.stars ?? null }))
    .filter((r) => r.stars != null);
  const out = [];
  for (const [key, label] of [['origin', '産地'], ['process', '精製'], ['roastLevel', '焙煎度']]) {
    const list = preferenceBy(rows, key);
    if (list.length < 2) continue;
    const f = (x) => `${x.key}（★${x.score}・${x.n}杯）`;
    const top = list.slice(0, 2).map(f).join('、');
    const bottom = list.length > 2 ? list.slice(-1).map(f).join('、') : '';
    out.push(`- ${label}：好き ${top}${bottom ? `／いまひとつ ${bottom}` : ''}`);
  }
  return out.length ? out : ['- （★のある記録がまだ少なく、好みは出せません）'];
}

/** 手元の豆の行（home.js の beanRows） */
export function stockLines(rows = []) {
  if (!rows.length) return ['- （手元に豆がありません）'];
  return rows.map((r) => {
    const b = r.bean;
    const desc = [b.roastLevel, originText(b), b.process].filter(Boolean).join('・');
    const fresh = r.frozenOnly ? '冷凍の袋だけ' : r.freshness ? `${r.freshness.label}（焙煎から${r.freshness.days}日）` : '焙煎日なし';
    return `- ${b.name}${desc ? `（${desc}）` : ''}${b.decaf ? '・カフェインレス' : ''}：残り${r.cups}杯、${fresh}`;
  });
}

/** 器具の行（グラインダーは目盛りの刻みも） */
export function equipmentLines(equipment = []) {
  const kinds = { grinder: 'グラインダー', dripper: 'ドリッパー', filter: 'フィルター', water: '水' };
  const list = equipment.filter((e) => alive(e) && kinds[e.kind]);
  if (!list.length) return ['- （器具の登録なし）'];
  return list.map((e) => `- ${kinds[e.kind]}：${e.name}${e.kind === 'grinder' && e.attrs?.step ? `（目盛りの刻み ${e.attrs.step}、数字が小さいほど細かい）` : ''}`);
}

/**
 * 相談のテキスト全体
 * @param {{question:string, extra?:string, bean?:object|null, brews?:object[], tastings?:object[], beans?:object[], rows?:object[], equipment?:object[], now?:Date}} p
 */
export function buildConsultText({ question = 'next', extra = '', bean = null, brews = [], tastings = [], beans = [], rows = [], equipment = [], now = new Date() }) {
  const q = QUESTIONS[question] ?? QUESTIONS.next;
  const qText = q.text.replace('{bean}', bean?.name ?? '手元の豆');
  const lines = [
    'ハンドドリップのコーヒーについて相談させてください。以下は私の記録です（自分のアプリから書き出しました）。',
    '',
    `## 質問`,
    qText,
    ...(String(extra ?? '').trim() ? [String(extra).trim()] : []),
    '',
    `## 直近の抽出（${question === 'bean' && bean ? `${bean.name}の` : ''}新しい順、最大${RECENT_N}杯。${localYmd(now)}時点）`,
    '★は5段階。「ちょうど良さ」はちょうどでなかった項目だけ。',
    ...brewTable({ brews, tastings, beans, equipment, beanId: question === 'bean' && bean ? bean.id : null }),
    '',
    '## 好み（★の平均を件数で補正した嗜好スコア）',
    ...preferenceLines({ brews, tastings, beans }),
    '',
    '## 手元の豆',
    ...stockLines(rows),
    '',
    '## 器具',
    ...equipmentLines(equipment),
    '',
    '## 答え方のお願い',
  ];
  if (q.recipe) {
    lines.push('一度に変える条件は1つにしてください（挽き目・比率・湯温のどれか）。最後に、次の形で書いてください（私のアプリに貼り戻して使います）。', '', ANSWER_FORMAT);
  } else {
    lines.push('それぞれ、私の記録のどこからそう考えたかを1文で添えてください。');
  }
  return lines.join('\n');
}

const NUM = '([0-9]+(?:\\.[0-9]+)?)';

/**
 * AIの答えから提案レシピを読む。全角の数字・「：」「:」のどちらでもよい。読めない項目は入れない。
 * @param {string} text
 * @returns {{overrides:object, beanName:string, reason:string, found:boolean}}
 */
export function parseAnswer(text) {
  const s = String(text ?? '').normalize('NFKC');
  const start = s.indexOf('【提案レシピ】');
  const body = start >= 0 ? s.slice(start) : s;
  const pick = (re) => re.exec(body)?.[1] ?? null;
  const line = (label) => pick(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`));
  const raw = {
    doseG: pick(new RegExp(`粉量\\s*[:：]\\s*(?:約)?${NUM}`)),
    waterG: pick(new RegExp(`湯量\\s*[:：]\\s*(?:約)?${NUM}`)),
    tempC: pick(new RegExp(`湯温\\s*[:：]\\s*(?:約)?${NUM}`)),
    grind: (line('挽き目') ?? '').replace(/[（(].*$/, '').replace(/^約/, '').trim(),
  };
  const overrides = normalizeOverrides(raw);
  const beanName = (line('豆') ?? '').replace(/^[（(]|[）)]$/g, '').trim();
  const reason = (line('理由') ?? '').trim();
  return { overrides, beanName, reason, found: Object.keys(overrides).length > 0 };
}

/**
 * 豆の名前から豆を探す（完全一致 → 含む）。見つからなければ null
 * @param {string} name
 * @param {object[]} beans 選べる豆
 */
export function findBeanByName(name, beans = []) {
  const n = String(name ?? '').normalize('NFKC').trim();
  if (!n) return null;
  const norm = (v) => String(v ?? '').normalize('NFKC').trim();
  return beans.find((b) => norm(b.name) === n) ?? beans.find((b) => n.includes(norm(b.name)) || norm(b.name).includes(n)) ?? null;
}
