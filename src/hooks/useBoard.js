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

const THROTTLE_MS = 50; // 20 Hz max render rate

/**
 * @param {object} board — a BoardImpl instance
 * @returns {{ renderState: object|null, refresh: () => void }}
 */
export function useBoard(board) {
  const [renderState, setRenderState] = useState(null);
  const pendingRef = useRef(false);
  const timerRef = useRef(null);

  const doRefresh = useCallback(() => {
    if (!board || !board.getRenderState) return;
    try {
      setRenderState(board.getRenderState());
    } catch {
      // Board might not have a valid netlist yet
    }
    pendingRef.current = false;
  }, [board]);

  const refresh = useCallback(() => {
    doRefresh();
  }, [doRefresh]);

  useEffect(() => {
    if (!board) return;

    // Initial render state
    doRefresh();

    // Subscribe to changes if the board supports it
    if (board.onChange) {
      const handler = () => {
        // Throttle: mark as pending, schedule refresh if not already scheduled
        if (!pendingRef.current) {
          pendingRef.current = true;
          timerRef.current = setTimeout(() => {
            doRefresh();
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
