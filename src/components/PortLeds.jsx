/**
 * LEDS — what the machine is doing, on the wires rather than the screen.
 *
 * The counterpart to `SwitchPanel`. A program that writes an 8255 port is
 * blinking something on a real board, and until now that went nowhere a
 * person could see: `video()` shows the CGA page and nothing showed the pins.
 * Half the corpus's device programs — traffic lights, a stepper, a bargraph —
 * produce no screen output at all and were therefore invisible while working
 * perfectly.
 *
 * A LAMP IS LIT ONLY WHERE THE CHIP IS DRIVING. Each port reports `value`
 * (what the chip drives), `dir` (which bits it drives) and `pins` (what the
 * wires carry). Drawing `value` alone would light a lamp for a bit configured
 * as an INPUT — a wire the chip is not driving at all — and an 8255's mode
 * word can flip a port to input at any instruction, leaving those lamps
 * showing a pattern the program has stopped controlling. Undriven bits are
 * drawn as ABSENT rather than dark, because "off" and "not mine" are
 * different facts and a learner reading a bargraph needs to tell them apart.
 */
import React from 'react';

function PortRow ({chip, port, value, dir, pins}) {
    const lamps = [];
    for (let bit = 7; bit >= 0; bit--) {
        const driven = (dir >> bit) & 1;
        const high = (pins >> bit) & 1;
        lamps.push(
            <span
                key={bit}
                className={`bw-led ${!driven ? 'is-undriven' : high ? 'is-on' : 'is-off'}`}
                data-testid={`bw-led-${chip}-${port}-${bit}`}
                aria-label={`${chip} port ${port.toUpperCase()} bit ${bit}: `
                    + (!driven ? 'not driven' : high ? 'on' : 'off')}
                title={!driven ? 'input — the chip is not driving this pin' : (high ? 'on' : 'off')}
            >{driven ? (high ? '●' : '○') : '·'}</span>
        );
    }
    return (
        <div className="bw-led-port" data-testid={`bw-led-port-${chip}-${port}`}>
            <span className="bw-led-label">{chip} P{port.toUpperCase()}</span>
            {lamps}
            <span className="bw-led-hex">
                {driveHex(value, dir)}
            </span>
        </div>
    );
}

/** The byte a program would read back, with undriven bits shown as dashes
 *  rather than zeros — a zero there is a claim the chip is driving low. */
function driveHex (value, dir) {
    let s = '';
    for (let bit = 7; bit >= 0; bit--) {
        s += ((dir >> bit) & 1) ? String((value >> bit) & 1) : '-';
    }
    return s;
}

/**
 * @param {{outputsFn: () => Array<{chip,port,bits,value,dir,pins}>}} props
 *   A FUNCTION, not an array: port state changes every instruction, so the
 *   panel asks per render. Passing a snapshot would draw a photograph, which
 *   is the same mistake as putting `value` in a capability.
 */
export function PortLeds ({outputsFn}) {
    const ports = typeof outputsFn === 'function' ? outputsFn() : null;
    if (!Array.isArray(ports) || !ports.length) return null;
    return (
        <div className="bw-led-panel" data-testid="bw-led-panel">
            {ports.map((p) => (
                <PortRow key={`${p.chip}.${p.port}`} {...p} />
            ))}
        </div>
    );
}

export default PortLeds;
