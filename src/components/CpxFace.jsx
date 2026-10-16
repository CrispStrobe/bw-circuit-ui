import React, {useEffect, useRef} from 'react';
import {CPX_FACE, cpxPixelFill} from '../model/cpx-face.js';

function CpxButton({name, position, down, onInput}) {
  const held = useRef(false);
  const input = useRef(onInput);
  input.current = onInput;
  const release = event => {
    event?.stopPropagation();
    if (!held.current) return;
    held.current = false;
    input.current?.({button: name, down: false});
  };
  useEffect(() => () => {
    if (!held.current) return;
    held.current = false;
    onInput?.({button: name, down: false});
  }, [name, onInput]);
  const press = () => {
    if (!input.current || held.current) return;
    held.current = true;
    input.current({button: name, down: true});
  };
  return <circle cx={position.x} cy={position.y} r={6.5}
    data-cpx-button={name} role="button" aria-label={`CPX ${name}`}
    aria-pressed={Boolean(down)} aria-disabled={!onInput} tabIndex={onInput ? 0 : undefined}
    fill={down ? '#f472b6' : '#1e1e1e'} stroke="#dcdcdc" strokeWidth={1}
    style={{pointerEvents: 'auto', touchAction: 'none', cursor: onInput ? 'pointer' : 'default'}}
    onPointerDown={event => {
      event.stopPropagation();
      if (!onInput) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      press();
    }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onBlur={release}
    onKeyDown={event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation(); press();
    }}
    onKeyUp={event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation(); release();
    }}
    onClick={event => event.stopPropagation()} />;
}

/** A projection of host state. This component owns no CPX simulation. */
export function CpxFace({width, height, state, onInput}) {
  const knownRedLed = typeof state?.redLed === 'boolean';
  return <svg x={-width / 2} y={-height / 2} width={width} height={height}
    viewBox={`0 0 ${CPX_FACE.width} ${CPX_FACE.height}`} preserveAspectRatio="none"
    data-cpx-live-face={state ? 'live' : 'unavailable'} style={{pointerEvents: 'none'}}>
    {CPX_FACE.pixels.map((p, index) => <circle key={index} cx={p.x} cy={p.y} r={5.3}
      data-cpx-pixel={index} fill={cpxPixelFill(state?.shown?.[index])} />)}
    <rect x={CPX_FACE.redLed.x - 2.215} y={CPX_FACE.redLed.y - 2.215}
      width={4.43} height={4.43} data-cpx-red-led={knownRedLed ? String(state.redLed) : 'unavailable'}
      fill={knownRedLed && state.redLed ? '#ff0000' : '#3f3f46'}>
      <title>{knownRedLed ? 'D13' : 'D13 state unavailable'}</title>
    </rect>
    {Object.entries(CPX_FACE.buttons).map(([name, position]) => <CpxButton key={name}
      name={name} position={position} down={state?.buttons?.[name]} onInput={state ? onInput : null} />)}
    <g role="button" aria-label="CPX slide switch" aria-pressed={Boolean(state?.switchRight)}
      aria-disabled={!state || !onInput} tabIndex={state && onInput ? 0 : undefined}
      data-cpx-switch={state?.switchRight ? 'right' : 'left'}
      style={{pointerEvents: 'auto', cursor: state && onInput ? 'pointer' : 'default'}}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        if (state && onInput) onInput({switchRight: !state.switchRight});
      }}
      onKeyDown={event => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat && state && onInput) onInput({switchRight: !state.switchRight});
      }}>
      <rect x={CPX_FACE.switch.x - 12.5} y={CPX_FACE.switch.y - 6.25} width={25} height={12.5}
        fill="#171717" stroke="#dcdcdc" strokeWidth={0.8} />
      <rect x={CPX_FACE.switch.x + (state?.switchRight ? 2 : -10)} y={CPX_FACE.switch.y - 4.5}
        width={8} height={9} fill="#dcdcdc" />
    </g>
  </svg>;
}
