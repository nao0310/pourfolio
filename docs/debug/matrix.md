# 設定を組み合わせた一斉点検の結果（総仕上げ、2026-11-18）

道具：`node scripts/debug/matrix.js`（設定の一覧は先頭の PROFILES）。毎回まっさらなブラウザのプロファイル（Playwright の Chromium、channel 'chromium'）で開き、各画面で `scripts/debug/audit.js` の点検（画面のエラー・横のはみ出し・文字の切れ・44px未満・12px未満・色の差・読み込み中のまま・undefined/NaN の表示）と、見出し・ボタン・下のタブ・入力欄を描いたフォント（中国語用のフォントなら「中国語の字形」）を数えた。

- 本番と同じ Service Worker：`pourfolio.test` を自分のPCに向けて、安全な場所として扱った（localhost では sw.js が毎回最新のファイルを取るため、オフラインや古い版の問題が隠れる）
- 天気（open-meteo）は本物に出さず、失敗として返した（P16 は 500）
- 時計は Playwright の clock で合わせた
- **WebKit（Safari）はこの環境にないので、Safari だけで起きることはここでは確かめていない**。`docs/iphone-check-final.md` でユーザーが確かめる

## 1回目（直す前、字形を直したあと）

| 設定 | 言語・地域 | 色・表示 | 端末 | 保存・通信・時計 | データ | 画面数 | 見つかったこと |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P01 基本 | ja-JP・Asia/Tokyo | ライト | iPhone 13 | — | demo（データ demo：豆8・抽出80） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P02 ダーク・意地悪 | ja-JP・Asia/Tokyo | ダーク | iPhone 13 | — | nasty（データ nasty：豆15・抽出17） | 153 | 12px未満の文字 2、別の画面へ移った 8 |
| P03 英語・LA・SE | en-US・America/Los_Angeles | ライト | iPhone SE | — | demo（データ demo：豆8・抽出80） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P04 中国語・UTC・ダーク・大きい機種 | zh-CN・UTC | ダーク | iPhone 15 Pro Max | — | demo（データ demo：豆8・抽出80） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P05 横向き・動きを減らす・UTC | ja-JP・UTC | ライト・動きを減らす | iPhone 13 landscape | — | minimal（データ minimal：豆1・抽出1） | 70 | 12px未満の文字 1、別の画面へ移った 1 |
| P06 強いコントラスト（ダーク）・英語 | en-US・Asia/Tokyo | ダーク・強いコントラスト | iPhone 13 | — | demo（データ demo：豆8・抽出80） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P07 PC・中国語・LA・大量 | zh-CN・America/Los_Angeles | ライト | PC 1280 | — | bulk（データ bulk：豆104・抽出1040） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P08 PC・拡大200% | ja-JP・Asia/Tokyo | ライト・拡大200% | PC 1280（拡大） | — | demo（データ demo：豆8・抽出80） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P09 文字を大きく（既定24px）・意地悪 | ja-JP・Asia/Tokyo | ダーク・既定の文字24px | iPhone 13 | — | nasty（データ nasty：豆15・抽出17） | 74 | 12px未満の文字 1、別の画面へ移った 1 |
| P10 最小フォント16px・英語・UTC | en-US・UTC | ライト・最小16px | iPhone SE | — | demo（データ demo：豆8・抽出80） | 72 | 別の画面へ移った 1 |
| P11 localStorage が使えない（まっさら） | ja-JP・Asia/Tokyo | ライト | iPhone 13 | localStorage が使えない | まっさら（） | 53 | なし |
| P12 IndexedDB が使えない（まっさら） | ja-JP・Asia/Tokyo | ダーク | iPhone 13 | indexedDB が使えない | まっさら（） | 46 | 画面のエラー 33、色の差が足りない 1 |
| P13 空きが少ない（デモを入れようとする） | ja-JP・Asia/Tokyo | ライト | iPhone SE | 空き16KB | demo（データ demo：豆8・抽出80） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P14 オフライン（Service Worker のあと） | ja-JP・Asia/Tokyo | ライト | iPhone 13 | 本番と同じ Service Worker・オフライン | demo（データ demo：豆8・抽出80／Service Worker 準備済み） | 71 | 12px未満の文字 1、別の画面へ移った 1 |
| P15 遅い回線・キャッシュなしの初回 | en-US・Asia/Tokyo | ダーク | iPhone SE | 本番と同じ Service Worker・1ファイル400ms | まっさら（Service Worker 準備済み） | 53 | なし |
| P16 天気の問い合わせが失敗 | ja-JP・Asia/Tokyo | ライト | iPhone 13 | 天気が失敗 | demo（データ demo：豆8・抽出80） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P17 朝4:59（東京） | ja-JP・Asia/Tokyo | ダーク | iPhone 13 | 時計 2026-11-19T04:59:30+09:00 | demo（データ demo：豆8・抽出80） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P18 月末23:59（UTC） | zh-CN・UTC | ライト | iPhone 13 | 時計 2026-11-30T23:59:30Z | demo（データ demo：豆8・抽出80） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P19 大みそか23:59（LA） | en-US・America/Los_Angeles | ダーク | iPhone SE | 時計 2026-12-31T23:59:30-08:00 | demo（データ demo：豆8・抽出80） | 72 | 12px未満の文字 1、別の画面へ移った 1 |
| P20 元日0:30（東京）・空 | ja-JP・Asia/Tokyo | ライト | iPhone 13 | 時計 2027-01-01T00:30:00+09:00 | empty（データ empty：豆0・抽出0） | 53 | なし |

- 「12px未満の文字」は全部、名刺の大きさのレシピカード（recipe-card.html、印刷用）で、「別の画面へ移った」は全部、ダイヤルイン履歴の移り先。どちらも前からのもの
- P12（IndexedDB が使えない）の「画面のエラー」は Dexie が開けないときの console のエラーで、画面には「読み込めませんでした。開き直してください」が出る（findings の74番）
- P13（空きが少ない）は、CDP の Storage.overrideQuotaForOrigin が IndexedDB の書き込みに効かず、デモのデータが入ってしまった。**空きの少ない条件は、この表では確かめられていない**（流れの点検 `flows-data.js` で、使用量＋2KBにして復元を失敗させて確かめた：findings の61番）
- 中国語の字形：0件（字形を直す前は、どの言語の設定でも見出し・ボタン・入力欄・下のタブ・canvas が中国語用のフォントだった。`node scripts/debug/glyphs.js` で 39件中30件 → 0件）

## 流れの点検（操作のあと）

| 道具 | 試したこと | 設定 |
| --- | --- | --- |
| `scripts/debug/flows-beans.js` | 豆・在庫・気になる豆・注文・おすそ分け・器具・レシピの登録→編集→削除→取り消し、2度押し、残り0g・マイナス、長い名前、「戻る」（bfcache を有効にして） | iPhone 13・ja-JP・Asia/Tokyo、ポート8092 |
| `scripts/debug/flows-brew.js` | タイマー・途中で閉じて再開・隠れてから戻る・保存の連打・評価・実験、朝5時・月末・年末年始（3つの時刻の地域、開いたまま越える）、年間まとめの全部のカード、開いたり閉じたりする部分324か所 | iPhone 13、ポート8093 |
| `scripts/debug/flows-data.js` | 書き出す→全部消す→復元、古い形・壊れたファイル、localStorage・IndexedDB が使えない、空きが少ない、オフライン→通信が戻る、天気の失敗・遅れ・おかしな中身、Service Worker の更新（3.4 → 3.6）、遅い初回、準備中の失敗、自動ファイル保存 | iPhone 13・PC、本番と同じ Service Worker、ポート8094 |
