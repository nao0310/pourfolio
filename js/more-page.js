// その他（下のタブ「その他」）：ほかの画面への入口とアプリの番号
import { versionLabel } from './core/version.js';
import { $ } from './ui.js';
import { registerServiceWorker } from './pwa.js';

$('appVersion').textContent = versionLabel();
registerServiceWorker();
