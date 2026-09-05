/**
 * useBoard — React hook that subscribes to a BoardImpl's onChange.
 *
 * Returns the render state from getRenderState() and re-renders
 * at most 20 Hz (50ms throttle). Without this, a PWM pin toggling
 * at 7200 Hz would fire 7200 setState calls per second.
 *
 * Works with both internal boards (created by Circuit) and external
 * boards (provided by the host for live emulator integration).
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// 10 Hz: at 20 Hz the renderState tick was the main thread's biggest
// customer during an emulator run — the instruments read fine at 10 Hz
// and the reclaimed frames go to the emulator (press-to-pixel latency
// is the user-felt metric this serves).
const THROTTLE_MS = 100; // 10 Hz max render rate

/**
 * @param {object} board — a BoardImpl instance
 * @returns {{ renderState: object|null, refresh: () => void }}
 */
export function useBoard(board, performanceProbe = null) {
  const [renderState, setRenderState] = useState(null);
  const pendingRef = useRef(false);
  const timerRef = useRef(null);

  const doRefresh = useCallback((source = 'refresh') => {
    if (!board || !board.getRenderState) return;
    try {
      const next = board.getRenderState();
      if (performanceProbe) performanceProbe.mark(`board-state:${source}`);
      setRenderState(next);
    } catch {
      // Board might not have a valid netlist yet
    }
    pendingRef.current = false;
  }, [board, performanceProbe]);

  const refresh = useCallback(() => {
    doRefresh('refresh');
  }, [doRefresh]);

  useEffect(() => {
    if (!board) return;

    // Initial render state
    doRefresh('initial');

    // Subscribe to changes if the board supports it
    if (board.onChange) {
      const handler = () => {
        // Throttle: mark as pending, schedule refresh if not already scheduled
        if (!pendingRef.current) {
          pendingRef.current = true;
          timerRef.current = setTimeout(() => {
            doRefresh('change');
            timerRef.current = null;
          }, THROTTLE_MS);
        }
      };
      board.onChange(handler);
      return () => {
        if (board.offChange) board.offChange(handler);
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }
  }, [board, doRefresh]);

  return { renderState, refresh };
}
