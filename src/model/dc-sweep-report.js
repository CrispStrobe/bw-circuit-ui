/** Bounded static DC grids and typed reference curves; no simulator or I/O. */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export const DC_SWEEP_MAX_POINTS=501;

export function dcSweepGrid(from,to,points) {
  if (!finite(from)||!finite(to)||Math.abs(from)>1000||Math.abs(to)>1000||from===to) {
    throw new Error('DC sweep endpoints must be distinct finite voltages within -1000 to 1000 V');
  }
  if (!Number.isInteger(points)||points<2||points>DC_SWEEP_MAX_POINTS) {
    throw new Error('DC sweep requires 2 to 501 points, including both endpoints');
  }
  const grid=Array.from({length:points},(_,index)=>index===points-1?to:from+(to-from)*index/(points-1));
  if (grid.some((value,index)=>index>0&&(to>from?value<=grid[index-1]:value>=grid[index-1]))) {
    throw new Error('DC sweep grid collapses at floating-point resolution');
  }
  return grid;
}

export function validateDcSweepInput(circuit,sourceId,observations) {
  if (!circuit.parts?.length||circuit.parts.length>32) throw new Error('DC sweep requires 1 to 32 parts');
  if (!observations.length||observations.length>8) throw new Error('DC sweep requires 1 to 8 observations');
  if (circuit.unmapped?.length||circuit.losses?.length||circuit.analysisBlockers?.length) {
    throw new Error('DC sweep refuses unmapped parts, semantic losses or retained analysis blockers');
  }
  const sources=circuit.parts.filter(part=>part.id===sourceId);
  if (sources.length!==1||sources[0].kind!=='vsource') throw new Error(`DC sweep source ${sourceId} must name exactly one voltage source`);
  for (const part of circuit.parts) {
    if (['vsource','isource'].includes(part.kind)&&part.params?.wave&&part.params.wave!=='dc') {
      throw new Error(`DC sweep refuses non-DC waveform on ${part.id}`);
    }
  }
  // Do not stamp a stale explicit bias in preference to the swept volts value.
  if (Object.hasOwn(sources[0].params ?? {},'dcBias')) throw new Error(`DC sweep refuses explicit dcBias on ${sourceId}`);
}

export function parseExpectedDcSweep(text) {
  const value=JSON.parse(text);
  if (value?.schemaVersion!==1||typeof value.sourceId!=='string'||!value.sourceId
    ||!Array.isArray(value.observations)||!value.observations.length||value.observations.length>8
    ||!Array.isArray(value.samples)||value.samples.length<2||value.samples.length>DC_SWEEP_MAX_POINTS) {
    throw new Error('DC reference needs schemaVersion 1, sourceId, 1 to 8 observations and 2 to 501 samples');
  }
  const observations=value.observations.map(row=>{
    if (!row||!['voltage','current'].includes(row.kind)||row.unit!==(row.kind==='voltage'?'V':'A')
      ||typeof row.selector!=='string'||!row.selector
      ||(row.kind==='voltage'&&typeof row.reference!=='string')
      ||(row.kind==='current'&&row.reference!=null&&row.reference!=='')) {
      throw new Error('DC reference observation needs explicit kind, selector, reference and SI unit');
    }
    const relativeTolerance=row.relativeTolerance ?? 0;
    if (!finite(row.absoluteTolerance)||row.absoluteTolerance<0||!finite(relativeTolerance)||relativeTolerance<0) {
      throw new Error('DC reference requires finite nonnegative absolute/relative tolerances');
    }
    return {...row,reference:row.reference ?? '',relativeTolerance};
  });
  const sourceVoltageTolerance=value.sourceVoltageTolerance ?? 1e-12;
  if (!finite(sourceVoltageTolerance)||sourceVoltageTolerance<0) throw new Error('invalid DC source voltage tolerance');
  const samples=value.samples.map(row=>{
    if (!finite(row?.sourceVolts)||!Array.isArray(row.values)||row.values.length!==observations.length
      ||row.values.some(number=>!finite(number))) throw new Error('DC reference sample needs finite sourceVolts and every observation value');
    return {sourceVolts:row.sourceVolts,values:row.values};
  });
  const ascending=samples[1].sourceVolts>samples[0].sourceVolts;
  if (samples.some((row,index)=>index>0&&(ascending?row.sourceVolts<=samples[index-1].sourceVolts:row.sourceVolts>=samples[index-1].sourceVolts))) {
    throw new Error('DC reference source grid must be strictly ascending or descending');
  }
  return {sourceId:value.sourceId,observations,samples,sourceVoltageTolerance,provenance:value.provenance ?? null};
}

export function compareExpectedDcSweep(actual,expected) {
  const mismatches=[]; let structuralFailures=0,compared=0,passed=0,failed=0;
  const mismatch=(code,details,structural=false)=>{
    if (structural) structuralFailures++;
    const row={code,...details};
    if (mismatches.length<20) mismatches.push(row);
    else if (structural) mismatches[19]=row;
  };
  if (actual.sourceId!==expected.sourceId) mismatch('source-id',{},true);
  if (actual.observations.length!==expected.observations.length) mismatch('observation-count',{},true);
  for (let index=0;index<expected.observations.length;index++) {
    const wanted=expected.observations[index],got=actual.observations[index];
    if (!got||['kind','selector','reference','unit'].some(key=>got[key]!==wanted[key])) {
      mismatch('observation-identity',{observation:index},true);
    }
  }
  if (actual.samples.length!==expected.samples.length) mismatch('sample-count',{},true);
  for (let index=0;index<Math.min(actual.samples.length,expected.samples.length);index++) {
    const got=actual.samples[index],wanted=expected.samples[index];
    if (!finite(got.sourceVolts)||Math.abs(got.sourceVolts-wanted.sourceVolts)>expected.sourceVoltageTolerance) {
      mismatch('source-voltage',{index,actual:got.sourceVolts,expected:wanted.sourceVolts},true);
    }
    if (got.values?.length!==expected.observations.length) mismatch('value-count',{index},true);
    for (let channel=0;channel<expected.observations.length;channel++) {
      const spec=expected.observations[channel],value=got.values?.[channel],reference=wanted.values[channel];
      const error=Math.abs(value-reference),allowed=spec.absoluteTolerance+spec.relativeTolerance*Math.abs(reference);
      compared++;
      if (finite(value)&&finite(error)&&finite(allowed)&&error<=allowed) passed++;
      else { failed++; mismatch('observation-value',{index,observation:channel,actual:value,expected:reference,error,allowed}); }
    }
  }
  return {status:!structuralFailures&&!failed&&compared>0?'pass':'fail',
    counts:{compared,passed,failed,structuralFailures},mismatches,provenance:expected.provenance};
}
