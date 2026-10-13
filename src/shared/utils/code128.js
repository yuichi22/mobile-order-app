// Code128(コードセットB)の符号化。外部の画像生成サービスに頼らず、端末内で描画するために使う。
// 戻り値は「バー/スペースの幅(モジュール数)」の並び。先頭はバー。
// 規格の両端余白(クワイエットゾーン: 10モジュール以上)は描画側で付ける。

// 値0〜106の幅パターン(バー,スペース,バー,スペース,バー,スペース)。106=STOPは7要素。
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

const START_B = 104;
const START_C = 105;
const CODE_C = 99; // セットB中: 以降セットC(数字2桁を1文字に詰める)
const CODE_B = 100; // セットC中: 以降セットB
const STOP = 106;

const toWidths = (startCode, codes) => {
  const checksum = codes.reduce((sum, code, index) => sum + code * (index + 1), startCode) % 103;
  return [startCode, ...codes, checksum, STOP]
    .flatMap((code) => PATTERNS[code].split('').map(Number));
};

// 符号化できない文字(ASCII 32〜126 以外)を含む場合は null。
export const encodeCode128B = (text) => {
  const value = String(text ?? '');
  if (!value) return null;

  const codes = [];
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) return null;
    codes.push(code - 32);
  }

  return toWidths(START_B, codes);
};

// 数字の連続(4桁以上)をセットCで2桁ずつ詰める。会員カード("MB"+12桁)のように
// 英字の前置き+数字の値は、セットBのみより大幅に短く(=バーが太く)なりスマホ画面でも読みやすい。
export const encodeCode128 = (text) => {
  const value = String(text ?? '');
  if (!value) return null;
  if ([...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126)) return null;

  // 全体が偶数桁の数字ならセットCだけで済む。
  if (/^(\d\d)+$/.test(value)) {
    const codes = value.match(/\d\d/g).map(Number);
    return toWidths(START_C, codes);
  }

  const codes = [];
  let set = 'B';
  let index = 0;
  while (index < value.length) {
    const digitRun = value.slice(index).match(/^\d+/)?.[0] || '';
    if (digitRun.length >= 4) {
      // 奇数桁は先頭1桁をセットBで出してから偶数桁をセットCで詰める。
      let run = digitRun;
      if (run.length % 2 === 1) {
        if (set !== 'B') { codes.push(CODE_B); set = 'B'; }
        codes.push(run.charCodeAt(0) - 32);
        run = run.slice(1);
        index += 1;
      }
      if (set !== 'C') { codes.push(CODE_C); set = 'C'; }
      run.match(/\d\d/g).forEach((pair) => codes.push(Number(pair)));
      index += run.length;
      continue;
    }
    if (set !== 'B') { codes.push(CODE_B); set = 'B'; }
    codes.push(value.charCodeAt(index) - 32);
    index += 1;
  }

  return toWidths(START_B, codes);
};
