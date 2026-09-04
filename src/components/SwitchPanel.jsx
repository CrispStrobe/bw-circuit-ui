/**
 * SWITCHES AND SENSORS — the half of a workbench that changes the world.
 *
 * `VdpScreen` and `SerialConsole` show what the machine is doing. This is the
 * other direction: eight toggles per port, wired to `runner.setInput`, so a
 * program that polls an 8255 port sees a person flip something. Without it a
 * learner can watch a traffic-light controller and never press the pedestrian
 * button, which makes the lesson a video.
 *
 * IT RENDERS NOTHING WHEN THE MACHINE HAS NO INPUTS, and that is the whole
 * discipline rather than a nicety. `capabilities().inputs` is empty for a
 * board with no 8255 — nowhere to latch a switch — and a panel of toggles
 * that do nothing is indistinguishable from a program ignoring the user.
 *
 * IDLE IS HIGH, WHICH LOOKS BACKWARDS AND IS NOT. An undriven TTL input floats
 * high, so a switch at rest reads 1 and a CLOSED switch pulls the line to 0.
 * Every breadboard button in this corpus is wired that way, and a panel whose
 * "on" meant 1 would invert every program a learner tests. The label says
 * CLOSED rather than ON for the same reason.
 */
import React, {useCallback, useState} from 'react';

/** One port's eight bits. Bit 7 is drawn leftmost, as a datasheet prints it. */
function Port ({chip, port, bits, held, onToggle}) {
    const cells = [];
    for (let bit = bits - 1; bit >= 0; bit--) {
        const closed = held.has(`${chip}.${port}.${bit}`);
        cells.push(
            <button
                key={bit}
                type="button"
                className={`bw-switch ${closed ? 'is-closed' : ''}`}
                aria-pressed={closed}
                aria-label={`${chip} port ${port.toUpperCase()} bit ${bit}, ${closed ? 'closed' : 'open'}`}
                data-testid={`bw-switch-${chip}-${port}-${bit}`}
                onClick={() => onToggle(chip, port, bit, !closed)}
            >{bit}</button>
        );
    }
    return (
        <div className="bw-switch-port" data-testid={`bw-switch-port-${chip}-${port}`}>
            <span className="bw-switch-label">{chip} P{port.toUpperCase()}</span>
            {cells}
        </div>
    );
}

/**
 * @param {{inputs: Array<{chip: string, port: string, bits: number}>,
 *          setInputFn: (chip: string, port: string, bit: number, level: number) => boolean}} props
 */
export function SwitchPanel ({inputs, setInputFn}) {
    // Which switches are CLOSED. Held here rather than read back from the
    // machine because a port's bits can be outputs — reading one back tells
    // you what the PROGRAM drives, not what the person set, and the two
    // disagree the moment a program writes to a port a switch sits on.
    const [held, setHeld] = useState(() => new Set());

    const onToggle = useCallback((chip, port, bit, close) => {
        // The machine's answer decides, not ours. setInput returns false when
        // there is nothing to drive, and a control that moved anyway would be
        // lying about a machine that refused.
        if (typeof setInputFn !== 'function') return;
        if (setInputFn(chip, port, bit, close ? 0 : 1) === false) return;
        setHeld((prev) => {
            const next = new Set(prev);
            const key = `${chip}.${port}.${bit}`;
            if (close) next.add(key); else next.delete(key);
            return next;
        });
    }, [setInputFn]);

    if (!Array.isArray(inputs) || !inputs.length) return null;

    return (
        <div className="bw-switch-panel" data-testid="bw-switch-panel">
            <div className="bw-switch-help">
                Closing a switch pulls its line LOW, as a breadboard button does.
            </div>
            {inputs.map((p) => (
                <Port
                    key={`${p.chip}.${p.port}`}
                    chip={p.chip}
                    port={p.port}
                    bits={p.bits}
                    held={held}
                    onToggle={onToggle}
                />
            ))}
        </div>
    );
}

export default SwitchPanel;
