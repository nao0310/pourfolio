// ホーム画面に追加していないときの警告（spec 10.2）を出すかの判定

/**
 * iPhone・iPad か（iPadOS の Safari は Mac と同じ名乗り方をするので、タッチの点数で見分ける）
 * @param {{userAgent?:string, maxTouchPoints?:number}} env
 */
export function isIos({ userAgent = '', maxTouchPoints = 0 }) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * どの案内を出すか
 * - 'installed'：ホーム画面のアプリとして開いている（何も出さない）
 * - 'ios-browser'：iPhone・iPad のブラウザで開いている（7日で記録が消えることがあるので、目立つ警告）
 * - 'other-browser'：PCなどのブラウザ（小さい一文だけ）
 * @param {{userAgent?:string, maxTouchPoints?:number, standalone:boolean}} env
 */
export function installAdvice(env) {
  if (env.standalone) return 'installed';
  return isIos(env) ? 'ios-browser' : 'other-browser';
}
