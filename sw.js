// service worker（最小限）。ホーム画面アプリとして登録されることを確かめるためのもの。
// オフライン動作（キャッシュ）はステップ 2-1（G3）で追加する。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
