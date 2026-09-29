/**
 * Does a servo's engine state say something has set its angle?
 *
 * The face shows the horn and the angle when it does, and "no signal" when it
 * does not. It used to ask only `_riseNs > 0n` — "has a pulse rising edge been
 * seen after t = 0" — which read two driven servos as undriven:
 *
 *  - a devices-block `set servo angle` (bw-board setDeviceControl 'angle') on a
 *    servo no MCU pin drives sets the target with no pulse at all, so the horn
 *    swung while the face said "no signal";
 *  - a pulse train whose first rise lands at t = 0 records _riseNs = 0n.
 *
 * The engine now says where the angle came from: `signal` is 'pulse' (a decoded
 * pulse), 'control' (setDeviceControl), or null (nothing yet). An older engine
 * has no `signal`, and the rise time is still honoured for it.
 *
 * @param {{signal?: string|null, _riseNs?: bigint}|null|undefined} ds
 * @returns {boolean}
 */
export function servoHasSignal(ds) {
  if (!ds) return false;
  if (ds.signal != null) return true;
  return typeof ds._riseNs === 'bigint' && ds._riseNs > 0n;
}
