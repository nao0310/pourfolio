---
name: phase-start
description: docs/ROADMAP.md のステップを始める。関係する設計を読み、計画を示して承認を待つ
disable-model-invocation: true
argument-hint: [ステップ番号 例 1-2]
---

ROADMAPのステップ $ARGUMENTS を始めます。

1. `docs/PROGRESS.md` の最新の記録と、`docs/ROADMAP.md` のステップ $ARGUMENTS を読む
2. ステップに書かれた機能IDについて、`docs/spec.md` の該当する章と表を読む
3. 今のコードとテストを確認する
4. 次の形で計画を示す
   - 作るもの（機能IDごとに1〜2行）
   - 変更・追加するファイル
   - 追加するテスト
   - 完成の確認方法（PCの画面とiPhoneで何を確かめるか）
   - 決める必要があること（あれば選択肢つきで質問する）
5. ここで止まり、ユーザーの「OK」を待つ。OKの前にファイルを編集しない
6. OKが出たら、mainを最新にしてからブランチ `phase-$ARGUMENTS-<短い英語>` を作り、小さな単位で実装とテストを進める
