# 進捗ログ（新しいものが上）

書き方：日付とステップ番号の見出しの下に「やったこと／確認結果／未解決／次の一手」を書く。

## 2026-11-18 ステップ0-1・0-2 開発の土台と公開テスト
- やったこと：Gitリポジトリ化とGitHubの公開リポジトリ（nao0310/pourfolio）の作成、package.json（npm test／npm run serve／npm run icons）、テストの雛形（js/core/format.js）、仮トップ画面、manifest、最小のservice worker、仮アイコン、IndexedDBの保存テスト画面、GitHub Pages（mainのルート）の有効化、手順書「はじめに」
- 確認結果：npm test 3件成功。PCのBrowserペインでトップ画面と保存テストを表示し、保存した値が再読み込み後も残ることを確認。manifestとアイコンの配信もOK。公開URLではservice workerが動作（activated）。iPhoneでホーム画面に追加し、アプリを閉じて開き直しても保存テストの値が残ることを確認（開き方：ホーム画面のアプリ、消されにくい保存：有効）
- 未解決：ローカルのBrowserペインではservice workerの登録が失敗する（公開URLでは成功するので、ローカル環境だけの問題）。手順書用の画面写真（docs/manual/SHOTS.md）は未撮影
- 次の一手：ステップ1-1（データの土台）を始める

## 2026-11-18 設計完了・スターターキット作成
- やったこと：設計草案（`docs/spec.md`）、進め方、スターターキット（このリポジトリの初期ファイル）を作成
- 確認結果：—
- 未解決：なし
- 次の一手：Claude Code でステップ 0-1（開発の土台）を始める
