/**
 * useTouch — touch event handling for tablet support.
 *
 * Provides:
 * - Single touch drag (move parts)
 * - Long press (context menu, 500ms threshold)
 * - Two-finger pinch-to-zoom
 * - Two-finger pan
 * - Tap (select)
 */

import { useRef, useCallback } from 'react';

const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD = 10; // pixels before a touch becomes a drag

/**
 * @param {{ onDrag, onDragEnd, onTap, onLongPress, onPinch, onPan }} handlers
 * @returns {{ onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }}
 */
export function useTouch({ onDrag, onDragEnd, onTap, onLongPress, onPinch, onPan }) {
  const state = useRef({
    startX: 0, startY: 0,
    lastX: 0, lastY: 0,
    moved: false,
    longPressTimer: null,
    startTime: 0,
    twoFingerStart: null, // { dist, cx, cy } for pinch/pan
  });

  const clearLongPress = useCallback(() => {
    if (state.current.longPressTimer) {
      clearTimeout(state.current.longPressTimer);
      state.current.longPressTimer = null;
    }
  }, []);

  const onTouchStart = useCallback((e) => {
    const touches = e.touches;

    if (touches.length === 2) {
      // Two fingers: pinch/pan start
      clearLongPress();
      const dx = touches[1].clientX - touches[0].clientX;
      const dy = touches[1].clientY - touches[0].clientY;
      state.current.twoFingerStart = {
        dist: Math.sqrt(dx * dx + dy * dy),
        cx: (touches[0].clientX + touches[1].clientX) / 2,
        cy: (touches[0].clientY + touches[1].clientY) / 2,
      };
      return;
    }

    if (touches.length !== 1) return;

    const touch = touches[0];
    state.current.startX = touch.clientX;
    state.current.startY = touch.clientY;
    state.current.lastX = touch.clientX;
    state.current.lastY = touch.clientY;
    state.current.moved = false;
    state.current.startTime = Date.now();

    // Start long-press timer
    state.current.longPressTimer = setTimeout(() => {
      if (!state.current.moved) {
        onLongPress?.(touch.clientX, touch.clientY);
      }
      state.current.longPressTimer = null;
    }, LONG_PRESS_MS);
  }, [onLongPress, clearLongPress]);

  const onTouchMove = useCallback((e) => {
    const touches = e.touches;

    if (touches.length === 2 && state.current.twoFingerStart) {
      // Pinch/pan
      const dx = touches[1].clientX - touches[0].clientX;
      const dy = touches[1].clientY - touches[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const cx = (touches[0].clientX + touches[1].clientX) / 2;
      const cy = (touches[0].clientY + touches[1].clientY) / 2;

      const scale = dist / state.current.twoFingerStart.dist;
      const panDx = cx - state.current.twoFingerStart.cx;
      const panDy = cy - state.current.twoFingerStart.cy;

      onPinch?.(scale);
      onPan?.(panDx, panDy);

      state.current.twoFingerStart = { dist, cx, cy };
      e.preventDefault();
      return;
    }

    if (touches.length !== 1) return;

    const touch = touches[0];
    const dx = touch.clientX - state.current.startX;
    const dy = touch.clientY - state.current.startY;

    if (!state.current.moved && Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
      state.current.moved = true;
      clearLongPress();
    }

    if (state.current.moved) {
      onDrag?.(touch.clientX, touch.clientY);
      state.current.lastX = touch.clientX;
      state.current.lastY = touch.clientY;
      e.preventDefault();
    }
  }, [onDrag, onPinch, onPan, clearLongPress]);

  const onTouchEnd = useCallback((e) => {
    clearLongPress();
    state.current.twoFingerStart = null;

    if (!state.current.moved) {
      // Tap (short touch without movement)
      const elapsed = Date.now() - state.current.startTime;
      if (elapsed < LONG_PRESS_MS) {
        onTap?.(state.current.startX, state.current.startY);
      }
    } else {
      onDragEnd?.();
    }

    state.current.moved = false;
  }, [onTap, onDragEnd, clearLongPress]);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd };
}
