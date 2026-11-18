// アプリの番号（Ver）と更新履歴（純粋関数）
// 番号はROADMAPのステップ番号と同じ（2-2 → 2.2）。マージ後の手直しは3つ目の数を足す（2.2.1）。
// ステップを仕上げるときに APP_VERSION と CHANGELOG の先頭を足す。上げ忘れは tests/version.test.js が見つける。
// sw.js の一覧（npm run sw）にも番号が入り、更新の知らせに新しい番号を出す。

export const APP_VERSION = '2.8';

/** 更新履歴（新しい順）。items は利用者向けの短い文で、2〜3個まで */
export const CHANGELOG = Object.freeze([
  {
    version: '2.8',
    date: '2026-11-18',
    items: [
      'トップのお知らせは右上の「×」で閉じられます。冷めた味の評価のお知らせは1時間で消え、「今回はしない」でも閉じられます',
      '画面の切り替えがなめらかになり、下のタブがちらつかなくなりました。豆の画面の下は「届いた」「この豆で淹れる」になります',
      '保存の2度押し、復元で設定が戻らない、2杯で淹れた杯を元にすると量が倍になる、などの不具合を直しました',
    ],
  },
  {
    version: '2.7',
    date: '2026-11-18',
    items: [
      'トップに「いつもの1杯」のボタンと、今日のカフェイン・控える時刻までの残り時間が出ます',
      'レシピをQRやリンクで共有・取り込みでき、キャニスターのQRを「QRを読む」で読むとその豆の淹れ方で開きます。レシピカード・月次レポートを印刷（PDF）できます',
      '評価の画面で1杯を1枚の画像にでき、PCでは決めたフォルダに自動でファイル保存できます',
    ],
  },
  {
    version: '2.6',
    date: '2026-11-18',
    items: [
      'トップの「今日の1杯」に、手元の豆からおすすめを理由つきで出します。「今日の一杯」の画面で気分を選んだり、カフェインを控える時刻を決めたりできます',
      '抽出の画面で、量（少なめ〜4杯）・アイス（急冷）・気分を選ぶと、粉量・湯量・注ぎ方を直します。新しい豆には、似た豆や焙煎度から最初のレシピを出します',
      '「その他」→「AIに相談」で、記録の要約をコピーして手元のチャットAIに相談し、答えのレシピで淹れられます',
    ],
  },
  {
    version: '2.5',
    date: '2026-11-18',
    items: [
      '下に「ホーム・抽出・豆と在庫・分析・その他」のタブが付きました',
      '分析の画面で、ダイヤルインの道のり・抽出チャート・好みの産地や焙煎度・カレンダーとカフェインが見られます（デモでも見られます）',
      'TDS（屈折計）と水の成分を記録でき、グラインダーの目盛りを別のミルに換算できます。タイマーに前回のベストとのずれが出ます',
    ],
  },
  {
    version: '2.4',
    date: '2026-11-18',
    items: [
      '味の評価で、香りや酸味などの「強さ」と「好み」を分けて記録でき、香味と雑味も選べます',
      '冷めてからの味も評価できます（15分後にトップでお知らせ）。粉や抽出液の写真も残せます',
      '焙煎度違いの豆をブラインドで飲み比べ、産地ごとの好きな焙煎度がわかります',
    ],
  },
  {
    version: '2.3.1',
    date: '2026-11-18',
    items: ['新しい版（Ver 2.3）に切り替わらないことがある不具合を直しました'],
  },
  {
    version: '2.3',
    date: '2026-11-18',
    items: [
      '豆を小分けにして冷凍し、1袋ずつ取り出して淹れられます（残量は常温＋冷凍）',
      '1杯の原価・月の支出・★1つあたりの値段がわかる「コスト」と「店の台帳」を足しました',
      '買い物リストで、送料無料ラインに届くまとめ買い案を出します',
    ],
  },
  {
    version: '2.2',
    date: '2026-11-18',
    items: [
      '珈琲問屋の注文メールを貼ると、注文した豆を「入荷待ち」でまとめて登録できます',
      '豆の登録で、商品ページの文章を貼ると銘柄・産地・価格などが入ります',
      '在庫とペースから注文の目安日を出し、買い物リストと注文メモを作れます',
    ],
  },
  {
    version: '2.1',
    date: '2026-11-18',
    items: ['通信がなくても全部の画面が開けるようになりました', '新しい版の準備ができると「更新する」で切り替えられます', 'Safariで開いているときは、ホーム画面に追加するよう案内します'],
  },
  {
    version: '1.7',
    date: '2026-11-18',
    items: ['トップ画面に今日の1杯・在庫・飲み頃・直近の抽出をまとめました', '書き出しの促しと、表計算用のCSVの書き出しを足しました'],
  },
  { version: '1.6', date: '2026-11-18', items: ['評価のあとに、次の1杯の直し方と根拠を出します'] },
  { version: '1.5', date: '2026-11-18', items: ['★・一言・ちょうど良さで味を評価できます'] },
  { version: '1.4', date: '2026-11-18', items: ['合図付きのタイマーで淹れ、実績を記録できます'] },
  { version: '1.3', date: '2026-11-18', items: ['器具とレシピ（4:6の雛形つき）を登録できます'] },
  { version: '1.2', date: '2026-11-18', items: ['豆を登録し、残量と飲み頃を見られます'] },
  { version: '1.1', date: '2026-11-18', items: ['記録の保存と、書き出し・復元ができます'] },
  { version: '0.2', date: '2026-11-18', items: ['iPhoneのホーム画面に追加して使えるようになりました'] },
]);

/** 「2.1.3」を [2, 1, 3] にする。形が違えば null */
export function parseVersion(v) {
  if (typeof v !== 'string' || !/^\d+(\.\d+){1,2}$/.test(v)) return null;
  return v.split('.').map(Number);
}

/** a が新しければ正、同じなら 0、古ければ負（2.1 と 2.1.0 は同じ） */
export function compareVersions(a, b) {
  const pa = parseVersion(a) ?? [];
  const pb = parseVersion(b) ?? [];
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 画面に出す形「Ver 2.1」 */
export function versionLabel(v = APP_VERSION) {
  return `Ver ${v}`;
}

/** ROADMAPのステップ番号（「2-1」）を番号（「2.1」）にする */
export function stepToVersion(step) {
  const m = /^(\d+)-(\d+)$/.exec(String(step ?? '').trim());
  return m ? `${Number(m[1])}.${Number(m[2])}` : null;
}

/**
 * ROADMAPの文章から、チェックの付いたステップのうちいちばん新しい番号を返す
 * @param {string} roadmap
 */
export function latestDoneStep(roadmap) {
  let best = null;
  for (const m of roadmap.matchAll(/^- \[x\] (\d+-\d+) /gm)) {
    const v = stepToVersion(m[1]);
    if (!best || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

/** この機能が入る前の番号。前に見た番号を覚えていない、記録のある利用者はこの版から上げたとみなす */
export const BEFORE_TRACKING = '2.1';

/**
 * 更新のあとに一度だけ出す「Ver ○ になりました」の中身
 * - 前に見た番号より新しい版の変更点を、新しい順にまとめる
 * - 前に見た番号がないとき：記録があれば 2.1 から上げたとみなし、なければ（初めて使う）出さない
 * @param {{lastSeen?:string|null, hasRecords?:boolean, current?:string, changelog?:readonly {version:string, items:string[]}[]}} args
 * @returns {{show:boolean, version:string, items:string[]}}
 */
export function whatsNew({ lastSeen = null, hasRecords = false, current = APP_VERSION, changelog = CHANGELOG } = {}) {
  const from = parseVersion(lastSeen ?? '') ? lastSeen : hasRecords ? BEFORE_TRACKING : null;
  if (!from || compareVersions(current, from) <= 0) return { show: false, version: current, items: [] };
  const items = changelog
    .filter((e) => compareVersions(e.version, from) > 0 && compareVersions(e.version, current) <= 0)
    .flatMap((e) => e.items);
  return { show: items.length > 0, version: current, items: items.slice(0, 6) };
}
