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
  const rows = [
    `# net=${safeComment(netId)} capture=${capture} sampleIntervalNs=${intervalNs} points=${count}`,
    capture === 'sample' ? 'elapsed_seconds,volts' : 'elapsed_seconds,min_volts,max_volts',
  ];
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
