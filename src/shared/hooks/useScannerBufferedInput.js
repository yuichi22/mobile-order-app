import { useCallback, useEffect, useRef } from 'react';

// バーコードリーダーの高速連続入力で、制御コンポーネント(value+onChange)が
// 「途中までしか読まない(文字の取りこぼし)」問題への対策。
//
// 仕組み:
//  - 連続入力は常にバッファにも記録する(列=gapMs以内の打鍵のまとまり)。
//  - 人には出せない速さ(stealMinLength文字以上・平均 stealAvgMs 未満)と判定できた時だけ、
//    以降のキーを preventDefault してネイティブ入力を止める(高速スキャンの取りこぼし対策)。
//    ⚠ 人の速打ち(〜100ms/字)まで奪うと「打った文字が消える/上書きされる」ため、奪う閾値は厳しく。
//  - Enter終端で、列が avgMs 未満(遅めのBluetoothスキャナも含む)ならスキャンとして commit。
//  - Enterの無い小休止(idleCommitMs)での commit は、奪った(=欄に出ていない)時だけ行う。
//  - それ以外(手入力)はそのまま素通り＝従来の onChange に委ねる(IME入力も壊さない)。

// IME(日本語入力)経由の打鍵か。Macは変換の最初の1打鍵で isComposing=false のことがあるため
// keyCode 229 / key 'Process' でも判定する。ローマ字の速打ちをスキャナと誤認して
// 打鍵を奪う(=変換が途中で勝手に確定する)のを防ぐ。
export const isImeKeyEvent = (event) => (
  Boolean(event?.isComposing) || event?.keyCode === 229 || event?.key === 'Process'
);

// スキャナの終端Enterは最後の文字から遅れて届くことがある(Bluetooth)。
const ENTER_GRACE_MS = 500;

export const createScannerBufferedState = () => ({
  buffer: '',
  base: '',
  start: 0,
  last: 0,
  scanning: false,
  timer: null
});

// state: createScannerBufferedState() で作った永続オブジェクト(ref等で保持)。
// commit(value): フィールドへ確定値をセットする関数(呼び出し側で正規化等を行う)。
// onManualEnter(event): スキャンではない通常のEnter時に呼ぶ(任意。フォーカス移動など)。
export const createScannerBufferedKeyDown = ({
  state,
  commit,
  onManualEnter,
  avgMs = 200,
  gapMs = 300,
  // idleCommitMs は「列束ね(gapMs)」より十分長くする。短いとスキャナの文字間隔の
  // ばらつき(Bluetoothは>120msになることがある)で途中フラッシュ→「後戻り/末尾欠け」になる。
  // 通常は終端Enterで確定し、これはEnterを送らないスキャナ向けの遅延フォールバック。
  idleCommitMs = 600,
  minLength = 2,
  // 打鍵を奪う(ネイティブ入力を止める)条件。USB/一般的なBluetoothスキャナは〜30ms/字。
  stealAvgMs = 40,
  stealMinLength = 4,
  // true: スキャンは列開始時のフィールド値を無視して「バッファのみ」を確定(置換)。
  //       バーコード欄・検索窓は1スキャン=コード全体なので置換が自然。
  // false: 列開始時のフィールド値＋バッファを確定(追記)。
  replace = true
}) => {
  const clearTimer = () => {
    if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
  };

  const resetScan = () => {
    clearTimer();
    state.buffer = '';
    state.base = '';
    state.scanning = false;
  };

  const commitBuffer = () => {
    const value = `${state.base}${state.buffer}`;
    resetScan();
    if (typeof commit === 'function') commit(value);
  };

  // 小休止での確定は「奪った(=欄に出ていない)」時だけ。手入力の速打ちを勝手に確定しない。
  const flush = () => {
    if (!state.scanning || !state.buffer) {
      resetScan();
      return;
    }
    commitBuffer();
  };

  const runAvg = (endTime) => (
    state.buffer.length >= 2 ? (endTime - state.start) / (state.buffer.length - 1) : Infinity
  );

  return (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isImeKeyEvent(event)) {
      // 変換中はスキャン列を破棄して素通り(IMEに任せる)。
      resetScan();
      state.last = Date.now();
      return;
    }

    const now = Date.now();
    const gap = now - state.last;
    state.last = now;

    if (event.key === 'Enter') {
      // 奪っている最中、または「列の直後のEnter」かつ列がスキャナ速度ならスキャンとして確定。
      // (遅めのBluetoothスキャナは奪わずに素通しで入るが、Enter終端でここに来る)
      const isScanEnter = state.buffer && (
        state.scanning
        || (gap <= ENTER_GRACE_MS && state.buffer.length >= minLength && runAvg(state.last - gap) < avgMs)
      );
      if (isScanEnter) {
        // フィールド側のEnter挙動は抑止。
        event.preventDefault();
        event.stopPropagation();
        commitBuffer();
        return;
      }
      resetScan();
      if (typeof onManualEnter === 'function') onManualEnter(event);
      return;
    }

    if (event.key.length !== 1) {
      // BS・矢印などは人の編集操作(スキャナは送らない)。列を打ち切る。
      if (!state.scanning) resetScan();
      return;
    }

    // 新しい連続入力列の開始判定。列開始時のフィールド値(=この打鍵前の値)を土台に保持。
    if (gap > gapMs || state.buffer === '') {
      resetScan();
      state.start = now;
      state.base = replace ? '' : (event.target?.value ?? '');
    }

    state.buffer += event.key;

    const shouldSteal = state.scanning
      || (state.buffer.length >= Math.max(minLength, stealMinLength) && runAvg(now) < stealAvgMs);

    if (shouldSteal) {
      state.scanning = true;
      // 取りこぼし防止: 以降はネイティブ入力させずバッファのみに集約する。
      event.preventDefault();
      // Enterを送らないスキャナ向けに、小休止で確定。
      clearTimer();
      state.timer = window.setTimeout(flush, idleCommitMs);
    }
    // 奪わない打鍵(=人の速さ)は preventDefault せず素通り。
  };
};

// 単一フィールド向けフック。最新の commit/onManualEnter を参照しつつ安定した onKeyDown を返す。
// ref へのアクセスはすべて返り値のイベントハンドラ内(=描画外)で行う。
export const useScannerBufferedInput = ({
  commit,
  onManualEnter,
  avgMs = 200,
  gapMs = 300,
  idleCommitMs = 600,
  minLength = 2,
  replace = true
} = {}) => {
  const commitRef = useRef(commit);
  const manualEnterRef = useRef(onManualEnter);
  const stateRef = useRef(null);
  const handlerRef = useRef(null);
  useEffect(() => {
    commitRef.current = commit;
    manualEnterRef.current = onManualEnter;
  });

  return useCallback((event) => {
    if (!stateRef.current) stateRef.current = createScannerBufferedState();
    if (!handlerRef.current) {
      handlerRef.current = createScannerBufferedKeyDown({
        state: stateRef.current,
        commit: (value) => commitRef.current?.(value),
        onManualEnter: (evt) => manualEnterRef.current?.(evt),
        avgMs,
        gapMs,
        idleCommitMs,
        minLength,
        replace
      });
    }
    handlerRef.current(event);
  }, [avgMs, gapMs, idleCommitMs, minLength, replace]);
};

export default useScannerBufferedInput;
