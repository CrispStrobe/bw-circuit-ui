/**
 * Distance, computed the same way in every JavaScript engine.
 *
 * `Math.hypot` is NOT required by the spec to be correctly rounded, so V8 and
 * JavaScriptCore may return values that differ in the last bits. That is
 * enough to change an answer: the PCB autorouter's A* compared costs built
 * from hypot, near-ties broke the other way in WebKit, and the same circuit
 * came out with traces on different copper layers in Safari than in Chrome
 * (board-projection.js, 2026-08-28).
 *
 * `Math.sqrt` IS correctly rounded per IEEE-754, so sqrt(dx*dx + dy*dy) gives
 * every engine the same double. It gives up hypot's overflow guard for very
 * large inputs, which nothing here has: these are millimetres on a board.
 *
 * Use this anywhere a distance becomes a VERDICT or a FILE — DRC clearances,
 * routing costs, exported geometry. Transient UI maths (hit-testing, drag
 * feedback) does not need it and still uses Math.hypot.
 */
export const dist = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
