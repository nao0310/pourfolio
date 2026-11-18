// 香味の選択（B4）：フレーバーホイールの9カテゴリと細かい語、雑味タグ（純粋関数）
// 選んだ香味は「カテゴリ/語」の文字（例 'fruity/citrus'）で持つ。細かい語が分からないときはカテゴリだけ（'fruity'）。
// 9カテゴリは spec 4.2（SCAのフレーバーホイールの第1層）。語は日本の家庭で思い浮かべやすいものに絞った。

/** 9カテゴリと、その下の細かい語 */
export const FLAVOR_WHEEL = Object.freeze([
  {
    key: 'floral',
    label: 'フローラル',
    words: [
      ['black-tea', '紅茶'],
      ['chamomile', 'カモミール'],
      ['rose', 'バラ'],
      ['jasmine', 'ジャスミン'],
    ],
  },
  {
    key: 'fruity',
    label: 'フルーティ',
    words: [
      ['berry', 'ベリー'],
      ['blackberry', 'ブラックベリー'],
      ['raspberry', 'ラズベリー'],
      ['blueberry', 'ブルーベリー'],
      ['strawberry', 'イチゴ'],
      ['citrus', '柑橘'],
      ['grapefruit', 'グレープフルーツ'],
      ['orange', 'オレンジ'],
      ['lemon', 'レモン'],
      ['lime', 'ライム'],
      ['dried-fruit', 'ドライフルーツ'],
      ['raisin', 'レーズン'],
      ['prune', 'プルーン'],
      ['cherry', 'チェリー'],
      ['apple', 'りんご'],
      ['peach', '桃'],
      ['pear', '洋梨'],
      ['grape', 'ぶどう'],
      ['pineapple', 'パイナップル'],
      ['pomegranate', 'ザクロ'],
      ['coconut', 'ココナッツ'],
    ],
  },
  {
    key: 'sour-fermented',
    label: '酸っぱい・発酵',
    words: [
      ['sour', '酸っぱい'],
      ['acetic', '酢のよう'],
      ['winey', 'ワインのよう'],
      ['whiskey', 'ウイスキーのよう'],
      ['fermented', '発酵'],
      ['overripe', '熟れすぎ'],
    ],
  },
  {
    key: 'green',
    label: 'グリーン・植物',
    words: [
      ['olive-oil', 'オリーブオイル'],
      ['raw', '生っぽい'],
      ['under-ripe', '未熟'],
      ['peapod', 'さやえんどう'],
      ['fresh', '青々しい'],
      ['hay', '干し草'],
      ['herb', 'ハーブ'],
      ['beany', '豆っぽい'],
    ],
  },
  {
    key: 'roasted',
    label: 'ロースト',
    words: [
      ['tobacco', 'たばこ'],
      ['smoky', 'スモーキー'],
      ['ashy', '灰'],
      ['brown-roast', '香ばしい'],
      ['grain', '穀物'],
      ['malt', 'モルト'],
    ],
  },
  {
    key: 'spices',
    label: 'スパイス',
    words: [
      ['pepper', 'こしょう'],
      ['anise', 'アニス'],
      ['nutmeg', 'ナツメグ'],
      ['cinnamon', 'シナモン'],
      ['clove', 'クローブ'],
    ],
  },
  {
    key: 'nutty-cocoa',
    label: 'ナッツ・ココア',
    words: [
      ['peanut', 'ピーナッツ'],
      ['hazelnut', 'ヘーゼルナッツ'],
      ['almond', 'アーモンド'],
      ['chocolate', 'チョコレート'],
      ['dark-chocolate', 'ダークチョコ'],
      ['cocoa', 'ココア'],
    ],
  },
  {
    key: 'sweet',
    label: '甘い',
    words: [
      ['brown-sugar', '黒糖'],
      ['molasses', '糖蜜'],
      ['maple', 'メープル'],
      ['caramel', 'キャラメル'],
      ['honey', 'はちみつ'],
      ['vanilla', 'バニラ'],
    ],
  },
  {
    key: 'other',
    label: 'その他',
    words: [
      ['woody', '木'],
      ['earthy', '土っぽい'],
      ['musty', 'かび臭い'],
      ['medicinal', '薬品'],
      ['rubber', 'ゴム'],
      ['salty', '塩気'],
    ],
  },
].map((c) => Object.freeze({ ...c, words: Object.freeze(c.words.map(([key, label]) => Object.freeze({ key, label }))) })));

/** 雑味タグ（spec 4.2）。記録だけで、次の1杯の提案（F1）の判定には使わない（D-105） */
export const DEFECT_TAGS = Object.freeze(['えぐい', '紙っぽい', '焦げ', '古い（酸化）', '水っぽい']);

/** すべての選べる値（ホイールの並び順。カテゴリ → その語） */
const ORDER = FLAVOR_WHEEL.flatMap((c) => [c.key, ...c.words.map((w) => `${c.key}/${w.key}`)]);
const RANK = new Map(ORDER.map((p, i) => [p, i]));

/** 香味の値を分ける { category, word }。知らない値なら null */
export function parseFlavor(path) {
  if (!RANK.has(path)) return null;
  const [catKey, wordKey = null] = String(path).split('/');
  const category = FLAVOR_WHEEL.find((c) => c.key === catKey);
  const word = wordKey ? category.words.find((w) => w.key === wordKey) : null;
  return { category, word };
}

/** 香味の呼び方。語があれば語（「柑橘」）、カテゴリだけならカテゴリ（「フルーティ」）。知らない値は空文字 */
export function flavorLabel(path) {
  const f = parseFlavor(path);
  if (!f) return '';
  return f.word ? f.word.label : f.category.label;
}

/** 選んだ香味をそろえる：知らない値と重なりを捨て、ホイールの並び順にする */
export function normalizeFlavors(list) {
  const picked = new Set(Array.isArray(list) ? list.map((v) => String(v ?? '').trim()) : []);
  return ORDER.filter((p) => picked.has(p));
}

/** 雑味タグをそろえる：知らないタグを捨て、いつも同じ並びにする */
export function normalizeDefects(list) {
  const picked = new Set(Array.isArray(list) ? list.map((v) => String(v ?? '').normalize('NFKC').trim()) : []);
  // 「古い（酸化）」は NFKC で括弧が半角になるので、両方の形で照らし合わせる
  return DEFECT_TAGS.filter((t) => picked.has(t) || picked.has(t.normalize('NFKC')));
}

/** そのカテゴリで選んでいる値の数（カテゴリだけの選択も1つと数える） */
export function countInCategory(flavors, catKey) {
  return (flavors ?? []).filter((p) => p === catKey || String(p).startsWith(`${catKey}/`)).length;
}

/** 香味の値を足す・外す（入れ替えた新しい配列を返す） */
export function toggleFlavor(flavors, path) {
  const list = flavors ?? [];
  return normalizeFlavors(list.includes(path) ? list.filter((p) => p !== path) : [...list, path]);
}

/** 香味の短い一覧「柑橘・ジャスミン」 */
export function flavorsText(flavors, max = Infinity) {
  const labels = normalizeFlavors(flavors).map(flavorLabel);
  return labels.length > max ? `${labels.slice(0, max).join('・')} ほか${labels.length - max}` : labels.join('・');
}
