/** Serialize oscilloscope rings without pretending an envelope is a waveform. */
import { availableSampleCount } from './scope-tools.js';

const cell = value => Number.isNaN(value) ? 'NaN' : String(value);
const safeComment = value => String(value ?? '').replace(/[\r\n]+/g, ' ');

/** Serialize one scope channel, oldest measurement first. */
export function scopeTraceToCsv(data, netId = '') {
  if (!data?.samples || !Number.isFinite(Number(data.sampleIntervalNs))) return '';
  const depth = Math.floor(data.samples.length / 2);
  const count = availableSampleCount(data);
  if (!depth || !count) return '';
  const capture = data.capture === 'sample' ? 'sample' : 'envelope';
  const oldest = ((Number(data.writeIndex || 0) - count) % depth + depth) % depth;
  const intervalNs = Number(data.sampleIntervalNs);
  const startTimeNs = data.startTNs == null ? '0' : String(data.startTNs);
  const rows = [
    `# net=${safeComment(netId)} capture=${capture} startTimeNs=${startTimeNs} sampleIntervalNs=${intervalNs} points=${count}`,
    capture === 'sample' ? 'elapsed_seconds,volts' : 'elapsed_seconds,min_volts,max_volts',
  ];
  if (data.adc) {
    const adc=data.adc, source=adc.source;
    if (capture!=='sample' || data.channelType!=='voltage'
      || source?.startTimeNs!==startTimeNs || source.sampleIntervalNs!==String(data.sampleIntervalNs)
      || source.count!==data.count || source.writeIndex!==data.writeIndex || source.depth!==depth
      || adc.rawSamples?.length!==data.samples.length || adc.codes?.length!==depth
      || adc.clippingDirections?.length!==depth || adc.descriptor?.kind!=='ideal-uniform-adc'
      || adc.descriptor.physicalHardwareModel!==false) throw new Error('ADC CSV source/descriptor mismatch');
    if ((Object.hasOwn(adc,'held')&&typeof adc.held!=='boolean')
      || (Object.hasOwn(adc,'observerEpoch')&&(!Number.isSafeInteger(adc.observerEpoch)||adc.observerEpoch<0))) {
      throw new Error('ADC CSV held/local observer metadata mismatch');
    }
    const context=(Object.hasOwn(adc,'held')?` held=${adc.held}`:'')
      +(Object.hasOwn(adc,'observerEpoch')?` observerEpoch=${adc.observerEpoch}`:'');
    const modeled=[`${rows[0]} adc=${safeComment(JSON.stringify(adc.descriptor))} source=${safeComment(JSON.stringify(source))}${context}`,
      'elapsed_seconds,input_volts,adc_code,volts,clipping'];
    for(let offset=0;offset<count;offset++) {
      const index=(oldest+offset)%depth, code=adc.codes[index], clipping=adc.clippingDirections[index];
      if (!['none','below','above','gap'].includes(clipping)
        || (clipping==='gap' ? code!==null : !Number.isInteger(code)||code<0||code>=adc.descriptor.levels)) {
        throw new Error('ADC CSV code/clipping mismatch');
      }
      modeled.push(`${offset*intervalNs/1e9},${cell(adc.rawSamples[index*2])},${code??''},${cell(data.samples[index*2])},${clipping}`);
    }
    return modeled.join('\n');
  }
  if (data.coupling) {
    const coupling=data.coupling;
    if (capture!=='sample' || data.channelType!=='voltage' || coupling.rawSamples?.length!==data.samples.length
      || coupling.descriptor?.kind!=='first-order-rc-highpass' || coupling.descriptor.physicalHardwareModel!==false) {
      throw new Error('AC coupling CSV source/descriptor mismatch');
    }
    const modeled=[`${rows[0]} coupling=${safeComment(JSON.stringify(coupling.descriptor))}`,
      'elapsed_seconds,input_volts,volts'];
    for(let offset=0;offset<count;offset++) {
      const index=(oldest+offset)%depth;
      modeled.push(`${offset*intervalNs/1e9},${cell(coupling.rawSamples[index*2])},${cell(data.samples[index*2])}`);
    }
    return modeled.join('\n');
  }
  for (let offset = 0; offset < count; offset++) {
    const index = (oldest + offset) % depth;
    const elapsed = (offset * intervalNs) / 1e9;
    const min = data.samples[index * 2];
    const max = data.samples[index * 2 + 1];
    rows.push(capture === 'sample'
      ? `${elapsed},${cell(min)}`
      : `${elapsed},${cell(min)},${cell(max)}`);
  }
  return rows.join('\n');
}

/** Serialize independent channel rings as labelled CSV sections. */
export function scopeTracesToCsv(traces) {
  return (traces || []).map(({ data, netId }) => scopeTraceToCsv(data, netId))
    .filter(Boolean).join('\n\n');
}
