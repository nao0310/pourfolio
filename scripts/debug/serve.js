// 総点検（2-8）用：試すデータごとにポートを分けて開発サーバーを立てる（保存場所がポートごとに分かれるため）。
// 使い方：node scripts/debug/serve.js 8082
// ポートの割り当て：8082 空、8083 最小、8084 デモ、8085 意地悪、8086 大量（8080・8081 は使わない＝確認用データを壊さない）
const port = Number(process.argv[2]);
if (!(port >= 8082 && port <= 8099)) {
  console.error('8082〜8099 のポート番号を付けてください（例：node scripts/debug/serve.js 8082）');
  process.exit(1);
}
process.env.PORT = String(port);
await import('../serve.js');
