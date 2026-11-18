---
name: fix-issue
description: GitHubのIssue番号を指定して、iPhoneなどで見つけた不具合を直す
disable-model-invocation: true
argument-hint: [Issue番号]
---

GitHub Issue #$ARGUMENTS を直します。

1. `gh issue view $ARGUMENTS` で内容を読む
2. 再現手順と原因を調べ、直し方を短く説明して、ユーザーの「OK」を待つ
3. OKが出たら、ブランチ `fix-$ARGUMENTS` を作って直し、同じ不具合を防ぐテストを追加する
4. `npm test` と画面確認のあと、PRを作り、本文に「Closes #$ARGUMENTS」を入れる
5. `docs/PROGRESS.md` の先頭に1行追記する
