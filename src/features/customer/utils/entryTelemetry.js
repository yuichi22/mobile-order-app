// QR入場ファネルの計測。端末側で何が起きているかはサーバーから観測できない
// (2026-09「利用中です」多発の調査で判明)ため、各段階の到達を記録する。
// 失敗しても入場フローには影響させない(fire-and-forget)。
import { getServerClockOffsetMs } from '../../../shared/utils/serverClock';

const ENDPOINT = '/api/recordEntryEvent';
const entryStartedAt = Date.now();

const buildPayload = (event, data = {}) => ({
  event: String(event || ''),
  elapsedMs: Date.now() - entryStartedAt,
  clockOffsetMs: getServerClockOffsetMs(),
  clientTime: new Date().toISOString(),
  timezoneOffsetMin: new Date().getTimezoneOffset(),
  screen: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
  standalone: typeof navigator !== 'undefined' && navigator.standalone === true,
  ...data
});

export const recordEntryEvent = (event, data = {}) => {
  try {
    const body = JSON.stringify(buildPayload(event, data));

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {});
  } catch {
    // 計測は本体の動作に影響させない
  }
};
