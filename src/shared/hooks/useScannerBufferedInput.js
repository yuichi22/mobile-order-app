import { useCallback, useEffect, useRef } from 'react';

// バーコードリーダーの高速連続入力で、制御コンポーネント(value+onChange)が
// 「途中までしか読まない(文字の取りこぼし)」問題への対策。
//
// 仕組み:
//  - スキャナ速度(平均文字間隔が avgMs 未満)の連続入力を検出したら、以降のキーを
//    preventDefault してネイティブ入力を止め、バッファに溜める。
//  - Enter、または小休止(idleCommitMs)で「列開始時のフィールド値＋バッファ」を
//    1回だけ commit する。これにより1スキャン＝1回のstate更新になり取りこぼさない。
//  - 低速(手入力)はそのまま素通り＝従来の onChange に委ねる(IME入力も壊さない)。

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

  const flush = () => {
    if (!state.scanning || !state.buffer) {
      resetScan();
      return;
    }
    const value = `${state.base}${state.buffer}`;
    resetScan();
    if (typeof commit === 'function') commit(value);
  };

  return (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

    const now = Date.now();
    const gap = now - state.last;
    state.last = now;

    if (event.key === 'Enter') {
      if (state.scanning && state.buffer) {
        // スキャン中のEnterはバッファをまとめて確定。フィールド側のEnter挙動は抑止。
        event.preventDefault();
        event.stopPropagation();
        flush();
        return;
      }
      if (typeof onManualEnter === 'function') onManualEnter(event);
      return;
    }

    if (event.key.length !== 1) return; // 制御キー(矢印・BS等)は対象外

    // 新しい連続入力列の開始判定。列開始時のフィールド値(=この打鍵前の値)を土台に保持。
    if (gap > gapMs || state.buffer === '') {
      state.buffer = '';
      state.start = now;
      state.base = replace ? '' : (event.target?.value ?? '');
      state.scanning = false;
    }

    state.buffer += event.key;

    const avg = state.buffer.length >= 2 ? (now - state.start) / (state.buffer.length - 1) : Infinity;
    const isScanSpeed = state.buffer.length >= minLength && avg < avgMs;

    if (isScanSpeed) {
      state.scanning = true;
      // 取りこぼし防止: 以降はネイティブ入力させずバッファのみに集約する。
      event.preventDefault();
      // Enterを送らないスキャナ向けに、小休止で確定。
      clearTimer();
      state.timer = window.setTimeout(flush, idleCommitMs);
    }
    // isScanSpeed でない(=手入力)は preventDefault せず素通り。
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
