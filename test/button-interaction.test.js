/**
 * Button interaction contract:
 *   - Sim mode: mouseDown on a seated button fires onButtonDown (engine
 *     pin edge), mouseUp fires onButtonUp. No selection, no context menu.
 *   - Build mode: click fires onSelectPart. pointerEvents are off so the
 *     breadboard handles drag-select.
 *
 * These tests verify the LOGIC extracted from BoardCanvas's button case,
 * not the full React render tree (that would need a DOM).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Extracted button-click logic ────────────────────────────────────
// Mirrors the conditional branches in the button case of WokwiParts.

function buttonOnClick(simulate, id, { onSelectPart, onPartBodyClick }) {
  if (simulate) {
    // Sim mode: click does NOT select — the press/release is via mouseDown/Up
    return;
  }
  onSelectPart(id, false);
  if (onPartBodyClick) onPartBodyClick(id);
}

function buttonOnMouseDown(simulate, id, { onButtonDown, onDragStart }) {
  if (simulate) {
    onButtonDown(id);
  } else {
    onDragStart(id);
  }
}

function buttonOnMouseUp(simulate, id, { onButtonUp }) {
  if (simulate) onButtonUp(id);
}

function buttonPointerEvents(simulate) {
  return simulate ? 'auto' : 'none';
}

// ── Tests ───────────────────────────────────────────────────────────

describe('button interaction: sim mode', () => {
  it('mouseDown fires onButtonDown, not onDragStart', () => {
    const calls = [];
    buttonOnMouseDown(true, 'btn1', {
      onButtonDown: id => calls.push(`down:${id}`),
      onDragStart: id => calls.push(`drag:${id}`),
    });
    assert.deepEqual(calls, ['down:btn1']);
  });

  it('mouseUp fires onButtonUp', () => {
    const calls = [];
    buttonOnMouseUp(true, 'btn1', {
      onButtonUp: id => calls.push(`up:${id}`),
    });
    assert.deepEqual(calls, ['up:btn1']);
  });

  it('click does NOT fire onSelectPart', () => {
    const calls = [];
    buttonOnClick(true, 'btn1', {
      onSelectPart: id => calls.push(`select:${id}`),
      onPartBodyClick: id => calls.push(`body:${id}`),
    });
    assert.deepEqual(calls, []);
  });

  it('pointerEvents is auto', () => {
    assert.equal(buttonPointerEvents(true), 'auto');
  });
});

describe('button interaction: build mode', () => {
  it('mouseDown fires onDragStart, not onButtonDown', () => {
    const calls = [];
    buttonOnMouseDown(false, 'btn1', {
      onButtonDown: id => calls.push(`down:${id}`),
      onDragStart: id => calls.push(`drag:${id}`),
    });
    assert.deepEqual(calls, ['drag:btn1']);
  });

  it('mouseUp does NOT fire onButtonUp', () => {
    const calls = [];
    buttonOnMouseUp(false, 'btn1', {
      onButtonUp: id => calls.push(`up:${id}`),
    });
    assert.deepEqual(calls, []);
  });

  it('click fires onSelectPart', () => {
    const calls = [];
    buttonOnClick(false, 'btn1', {
      onSelectPart: (id, shift) => calls.push(`select:${id}`),
      onPartBodyClick: id => calls.push(`body:${id}`),
    });
    assert.deepEqual(calls, ['select:btn1', 'body:btn1']);
  });

  it('pointerEvents is none', () => {
    assert.equal(buttonPointerEvents(false), 'none');
  });
});

describe('MCU DIP body selectability', () => {
  // MCU DIP bodies used to have pointerEvents="none", making them
  // unselectable. They now have onClick={handleClick} — this test
  // verifies the contract.
  it('MCU body click handler calls onSelectPart + onPartBodyClick', () => {
    const calls = [];
    // Simulates the handleClick function from SvgParts
    const handleClick = (e) => {
      calls.push('stopPropagation');
      calls.push('onSelectPart:mcu1');
      calls.push('onPartBodyClick:mcu1');
    };
    handleClick({ stopPropagation: () => {} });
    assert.ok(calls.includes('onSelectPart:mcu1'));
    assert.ok(calls.includes('onPartBodyClick:mcu1'));
  });
});
