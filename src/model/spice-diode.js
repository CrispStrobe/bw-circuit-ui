export const SHOCKLEY_THERMAL_VOLTAGE = 0.02585;
export const SHOCKLEY_FIXED_TEMP_C = 26.826793442075882;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

/**
 * A DIODE MODEL'S FIELDS, SORTED BY WHETHER THEY EXIST AT A DC BIAS POINT.
 *
 * The strict form of `validateExplicitShockley` admits `IS, N, RS` and nothing
 * else. Measured against the acquired LTspice `cmp/standard.dio`: **0 of 926
 * manufacturer models pass**, because every real part carries junction
 * capacitance, a breakdown voltage and vendor metadata. Field census over
 * those 926:
 *
 *     MFG 925   IS 924   RS 924   TYPE 924   N 916   VPK 895
 *     CJO 892   M 861    BV 839   VJ 834     ISR 819  IKF 818
 *
 * So the strict form is not strict about a rare case; it excludes every model
 * any vendor ships, and no amount of library acquisition can deliver anything
 * while it stands. Measured on Si7li's 7,866 LTspice netlists, 1,560 name a
 * diode the library defines and the rule refused all of them.
 *
 * The fields divide three ways, and the division is the fix:
 *
 *   DC        IS N RS — the Shockley curve at an operating point
 *   NOT DC    capacitance, transit time, grading, breakdown, temperature
 *             coefficients: they shape AC and TRANSIENT behaviour and are
 *             IDENTICALLY INERT in a bias solve
 *   NOT A     MFG and TYPE are a manufacturer string and a part class. They
 *   PARAMETER are not model parameters at all and never were.
 *
 * A field outside the DC set is therefore a NOTE at an operating point and a
 * LOSS for any analysis that reads it. The raw model text is preserved either
 * way, so an AC or transient consumer can refuse on exactly the fields it needs
 * and this decision cannot be mistaken for support it does not have.
 *
 * The DC-relevant list is ngspice's own diode parameter set, which is also the
 * one the corpus lane's worker enumerates in `MODEL_KEYS.D`.
 */
const DIODE_DC_FIELDS = new Set(['is', 'n', 'rs']);
/** Fields the importer MAPS onto another engine kind rather than setting aside. */
// Fields the reader MAPS onto an engine parameter rather than reading into the
// Shockley curve: `bv` becomes the zener kind's breakdown voltage and `ibv` the
// knee current that voltage is specified at. Being here rather than in
// DIODE_NON_DC_FIELDS is load-bearing in both directions -- a field that is
// neither DC, mapped, a non-parameter nor non-DC counts as UNKNOWN and blocks
// the whole model, which is exactly what happened when `ibv` was taken out of
// the non-DC set without being put in here: every BV+IBV card imported as a
// bare diode with no vz at all.
const DIODE_MAPPED_FIELDS = new Set(['bv', 'ibv']);
/**
 * Not model parameters at all: a manufacturer string, a part class, a datasheet
 * RATING, and the ideal-switch fields LTspice allows on a diode card.
 * Enumerated from the 36 distinct field names that actually occur across the
 * 926 library models, not guessed one at a time — `IAVE` was refused by a
 * hand-written list and is a rated average current, which no solver reads.
 */
const DIODE_NON_PARAMETERS = new Set([
  'mfg', 'type', 'iave', 'vpk', 'vp', 'central',
  // LTspice's ideal-diode switch fields. They describe a PIECEWISE device, not
  // this Shockley curve, so a model that leans on them is not the model we
  // solved — noted rather than silently absorbed.
  'ron', 'roff', 'vfwd', 'vrev', 'epsilon', 'revepsilon', 'ilimit',
  // A noise-only flag, carried bare. It changes no bias point, and ngspice
  // ignores it: `.model DLIMN D(Ron=100k Roff=100Meg Vfwd=1.1 Vrev=-300m
  // epsilon=.1 noiseless)` and a bare `.model DDEF D` both put 6.924935e-01
  // on the same 1k divider -- measured, not assumed. So a deck written for
  // LTspice's piecewise diode is still judgeable: the REFERENCE solves it as a
  // default Shockley diode, and taking the same defaults answers the same
  // question. The fields are reported as set aside, so nobody reads the
  // agreement as our having modelled a piecewise device.
  'noiseless',
]);
/** Everything ngspice's diode takes that does NOT move a bias point. */
const DIODE_NON_DC_FIELDS = new Set([
  // Junction capacitance and its grading, transit time, forward-bias
  // coefficient: charge storage, so AC and transient only.
  'cjo', 'cj0', 'cjp', 'vj', 'm', 'tt', 'fc',
  // Reverse breakdown SHAPE, minus the two fields that now move a bias point.
  //
  // `BV` IS NOT HERE, and the first version of this list had it, with a comment
  // claiming "a DC bias point never reaches it". That is an assumption about the
  // CIRCUIT, not a property of the field: a diode reverse-biased past BV
  // conducts, and calling the field inert would solve such a deck as an open. BV
  // is mapped instead — see `diodeBreakdown`.
  //
  // `IBV` IS NO LONGER HERE EITHER, for exactly the same reason one step later.
  // Its old comment said IBV describes a knee "which a piecewise zener does not
  // have", and that was true of the engine at the time. The engine now solves
  // the breakdown as an exponential through the point (BV, IBV) — ngspice's own
  // placement, measured to 0.186 mV over five decades — so IBV moves the bias
  // point by construction. Leaving it here would have been the BV mistake again,
  // and the field is stated on 976 corpus decks.
  //
  // `NBV`/`IBVL`/`NBVL` STAY, and the label is imprecise for them: they are not
  // inert, they are UNMODELLED — NBV is the breakdown region's ideality factor,
  // which our exponential fixes at 1, and IBVL/NBVL describe a second, low-level
  // breakdown segment we do not have at all. They are set aside with the raw
  // model kept, the same treatment ISR/NR/IKF get two entries down. Measured
  // population: 7 decks in Si7li no-aug, ZERO in ADI2005 v2 and v3, so the
  // imprecision is recorded rather than restructured for now.
  'nbv', 'ibvl', 'nbvl',
  // Temperature coefficients. The bias is solved at one fixed temperature, so
  // the coefficients that move it with temperature do not apply.
  'eg', 'xti', 'tnom', 'trs1', 'trs2', 'tbv1', 'tbv2', 'tikf',
  // Recombination and high-injection corrections. Real at a bias point in
  // principle and second-order here: bw-board's diode is the ideal Shockley
  // curve with a series RS and has nowhere to put them, so they are set aside
  // WITH THE RAW MODEL KEPT rather than being pretended into the solve.
  'isr', 'nr', 'ikf',
  // Flicker and burst noise.
  'kf', 'af',
  // Geometry and level, which this reader does not scale by.
  'level', 'area', 'perim', 'jtun', 'ntun', 'ilo', 'rl',
]);

/**
 * Split a diode model's fields into the ones a DC solve uses and the ones it
 * does not. `unknown` is reported separately from `nonDc`: a field nobody here
 * recognises may or may not move a bias point, and saying "not DC" about it
 * would be a claim rather than a classification.
 */
export function classifyDiodeFields(params) {
  const dc = {}, nonDc = [], nonParameter = [], unknown = [], mapped = [];
  for (const [k, v] of Object.entries(params || {})) {
    const key = k.toLowerCase();
    if (DIODE_DC_FIELDS.has(key)) dc[key] = v;
    else if (DIODE_MAPPED_FIELDS.has(key)) mapped.push(key);
    else if (DIODE_NON_PARAMETERS.has(key)) nonParameter.push(key);
    else if (DIODE_NON_DC_FIELDS.has(key)) nonDc.push(key);
    else unknown.push(key);
  }
  return { dc, nonDc, nonParameter, unknown, mapped };
}

export function validateExplicitShockley(params, raw = null) {
  if (raw != null) {
    let rest = String(raw).trim();
    if (rest.startsWith('(') && rest.endsWith(')')) rest = rest.slice(1, -1);
    const names = [];
    while (rest.trim()) {
      const match = rest.match(/^\s*,?\s*([A-Za-z_]\w*)\s*=\s*([^\s,()]+)([\s\S]*)$/)
        || rest.match(/^\s*,?\s*([A-Za-z_]\w*)()(?=\s|,|$)([\s\S]*)$/);
      if (!match) return { ok: false, reason: 'diode model contains unparsed or malformed syntax' };
      names.push(match[1].toLowerCase());
      rest = match[3];
    }
    if (new Set(names).size !== names.length || names.sort().join(',') !== 'is,n,rs') {
      return { ok: false, reason: 'exact diode model requires one each of IS, N and RS and no other model fields' };
    }
  }
  const keys = Object.keys(params || {}).sort();
  if (keys.join(',') !== 'is,n,rs') return { ok: false, reason: 'exact diode model requires explicit IS, N and RS and no other model fields' };
  const is = Number(params.is); const n = Number(params.n); const rs = Number(params.rs);
  if (!(Number.isFinite(is) && is > 0 && Number.isFinite(n) && n > 0 && Number.isFinite(rs) && rs >= 0)) {
    return { ok: false, reason: 'diode IS and N must be positive finite numbers and RS must be a non-negative finite number' };
  }
  return { ok: true, params: { model: 'shockley', is, n, rs } };
}

export function classifyShockleyThermal(lines) {
  const temps = []; const tnoms = [];
  const source = [];
  for (const line of lines || []) {
    if (/^\.temp\b/i.test(line)) {
      const temp = line.match(/^\.temp\s+([^\s]+)\s*$/i);
      temps.push(temp ? Number(temp[1]) : NaN); source.push(line);
    }
    const option = line.match(/^\.options?\b(.*)$/i);
    if (option) {
      if (/\btemp\b/i.test(option[1])) {
        const values = [...option[1].matchAll(/\btemp\s*=\s*([^\s]+)/ig)];
        if (!values.length) temps.push(NaN);
        else for (const match of values) temps.push(Number(match[1]));
        source.push(line);
      }
      if (/\btnom\b/i.test(option[1])) {
        const values = [...option[1].matchAll(/\btnom\s*=\s*([^\s]+)/ig)];
        if (!values.length) tnoms.push(NaN);
        else for (const match of values) tnoms.push(Number(match[1]));
        source.push(line);
      }
    }
  }
  if (!temps.length && !tnoms.length) return { ok: true, explicit: false, source: [] };
  const close = value => Number.isFinite(value) && Math.abs(value - SHOCKLEY_FIXED_TEMP_C) <= 1e-6;
  if (temps.length === 1 && tnoms.length === 1 && close(temps[0]) && close(tnoms[0])) {
    return { ok: true, explicit: true, source };
  }
  return { ok: false, explicit: true,
    source, reason: `diode DC requires one TEMP and one TNOM both equal to the fixed ${SHOCKLEY_FIXED_TEMP_C} C profile` };
}

/**
 * The DC-SCOPED form: the Shockley curve must be fully stated, and anything
 * that cannot move a bias point is a note rather than a refusal.
 *
 * Returns the same shape as `validateExplicitShockley` plus `notes`, so a
 * caller can report exactly what it set aside. It does NOT loosen the numeric
 * requirements — IS and N still have to be positive and finite and RS
 * non-negative, and a model that omits any of the three is still refused,
 * because the curve is then not stated.
 */
export function validateDiodeForDc(params, raw = null) {
  // MALFORMED SYNTAX STILL REFUSES. `modelParams` only matches `key=value`, so
  // a bare token inside a model body is silently dropped — a model written
  // `D(IS=2e-12 N=1.3 RS=4 garbage)` would otherwise be admitted as if the
  // stray word were not there. The strict validator checked the raw text for
  // exactly this and my first DC-scoped version did not, which is a regression
  // I introduced and this line is what caught it.
  if (raw != null) {
    let rest = String(raw).trim();
    if (rest.startsWith('(') && rest.endsWith(')')) rest = rest.slice(1, -1);
    const seen = [];
    while (rest.trim()) {
      // A VALUELESS FLAG IS VALID MODEL SYNTAX, and reading it as malformed
      // blamed our parser for a card SPICE accepts. LTspice's `noiseless` is
      // written bare, and the loop bailed on it before any field had been
      // classified -- so 4,139 diode models in an 800-deck sample of the
      // library-resolved corpus were refused as "unparsed or malformed
      // syntax" when the syntax was fine and the fields were merely ones we
      // set aside. A reason that names our own parser sends the next reader to
      // fix the parser.
      //
      // The flag is collected by NAME and then judged like any other field, so
      // a bare token is still not silently dropped: `D(IS=2e-12 N=1.3 RS=4
      // garbage)` now refuses for naming `garbage`, which is the honest reason.
      const assigned = rest.match(/^\s*,?\s*([A-Za-z_]\w*)\s*=\s*([^\s,()]+)([\s\S]*)$/);
      const match = assigned || rest.match(/^\s*,?\s*([A-Za-z_]\w*)()(?=\s|,|$)([\s\S]*)$/);
      if (!match) return { ok: false, reason: 'diode model contains unparsed or malformed syntax' };
      const field = match[1].toLowerCase();
      seen.push(field);
      // A FLAG STILL HAS TO BE A FIELD WE KNOW. `modelParams` only collects
      // `key=value`, so a valueless token never reaches `classifyDiodeFields`
      // and would be admitted as if it were not written -- which is why the
      // loop used to refuse the whole card. Checking the flag's NAME here
      // keeps that protection (`D(IS=2e-12 N=1.3 RS=4 garbage)` refuses, and
      // now says which token) while letting a recognized flag through.
      if (!assigned && !DIODE_DC_FIELDS.has(field) && !DIODE_MAPPED_FIELDS.has(field)
          && !DIODE_NON_PARAMETERS.has(field) && !DIODE_NON_DC_FIELDS.has(field)) {
        return { ok: false, reason: `diode model field "${match[1]}" is not a recognized model field` };
      }
      rest = match[3];
    }
    if (new Set(seen).size !== seen.length) {
      return { ok: false, reason: 'duplicate diode model fields are ambiguous' };
    }
  }
  const split = classifyDiodeFields(params);

  // AN OMITTED FIELD TAKES THE SIMULATOR'S DOCUMENTED DEFAULT.
  //
  // Refusing a model for stating no IS made us unable to judge decks the
  // REFERENCE handles without complaint: ngspice fills IS = 1e-14, N = 1,
  // RS = 0 and solves. Verified against it rather than read from a manual —
  // 0.65 V across 1 Ohm into `.model DEF D` (no parameters at all) puts the
  // junction at 0.6492044 V, and 1e-14 * exp(0.6492/0.02585) = 8.06e-4 A is
  // exactly the 0.8 mA that drop implies.
  //
  // So filling them is not a loosening, it is the only way the two sides are
  // the same circuit. On the first 2,000 ADI2005 decks this was 41 refusals,
  // ALL of them zeners written `BV=5.1 IBV=5m RS=5` — a breakdown voltage and a
  // bulk resistance, with the forward curve left to the defaults.
  //
  // A model with NO fields at all is still refused: `.model X D` names a
  // device nobody described, and taking the whole curve from defaults would
  // make an empty declaration indistinguishable from a considered one.
  const NGSPICE_DIODE_DEFAULTS = { is: 1e-14, n: 1, rs: 0 };
  const defaulted = [];
  if (Object.keys(split.dc).length || split.mapped.length || split.nonDc.length) {
    for (const [k, v] of Object.entries(NGSPICE_DIODE_DEFAULTS)) {
      if (!(k in split.dc)) { split.dc[k] = v; defaulted.push(k); }
    }
  }

  const keys = Object.keys(split.dc).sort().join(',');
  if (keys !== 'is,n,rs') {
    return { ok: false,
      reason: 'the diode model states no parameters at all, so there is no device to solve — '
        + 'a bare `.model X D` is a name, not a model' };
  }
  const numeric = validateExplicitShockley(split.dc);
  if (!numeric.ok) return numeric;
  if (split.unknown.length) {
    // An unrecognised field is refused, not noted. "Not DC" about a name
    // nobody here knows would be a claim, and a wrong one is how a model with
    // a real DC parameter gets solved as if it did not have it.
    return { ok: false,
      reason: `unrecognised diode model field(s) ${split.unknown.join(', ').toUpperCase()} — `
        + 'they are not classified as DC-inert, so this model is refused rather than guessed' };
  }
  return { ok: true, params: numeric.params,
    notes: { nonDc: split.nonDc, nonParameter: split.nonParameter, mapped: split.mapped,
      defaulted } };
}

/**
 * A D MODEL WITH A BREAKDOWN VOLTAGE IS A ZENER, and the importer already knew
 * that on its non-strict path (`if (letter === 'D' && model.params.bv) kind =
 * 'zener'`). Returning it here keeps the one rule in one place.
 *
 * 839 of the 926 library diode models carry BV, so the alternative — refusing
 * them, or worse calling BV inert — decides the fate of most of the library.
 *
 * @returns {number|null} the breakdown voltage, positive, or null
 */
export function diodeBreakdown(params) {
  const bv = Number(params?.bv ?? params?.BV);
  if (!Number.isFinite(bv) || bv === 0) return null;
  // SPICE states BV as a positive magnitude; a deck writing it negative means
  // the same device.
  return Math.abs(bv);
}

/**
 * The breakdown KNEE CURRENT, the current at which BV is specified.
 *
 * SPICE's default is 1e-3 A, and it is a real default rather than an absence:
 * ngspice places the junction so the current is IBV at |Vj| = BV whether or not
 * the card says so. But this reader returns null for a card that states no IBV,
 * because the engine's piecewise zener is what every shipped circuit is written
 * against and inventing a knee current for them would move all of it. A deck
 * that wants the exponential says IBV.
 */
export function diodeBreakdownCurrent(params) {
  const ibv = Number(params?.ibv ?? params?.IBV);
  if (!Number.isFinite(ibv) || ibv <= 0) return null;
  return Math.abs(ibv);
}

export function isExplicitShockleyPart(part) {
  const p = part?.params || {};
  return part?.kind === 'diode' && Object.keys(p).sort().join(',') === 'is,model,n,rs'
    && p.model === 'shockley' && own(p, 'is') && own(p, 'n') && own(p, 'rs')
    && validateExplicitShockley({ is: p.is, n: p.n, rs: p.rs }).ok;
}
