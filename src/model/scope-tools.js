/** Pure oscilloscope calculations, kept separate from React for deterministic tests. */

const midpoint = (samples, index) => {
  const min = samples[index * 2];
  const max = samples[index * 2 + 1];
  return Number.isNaN(min) || Number.isNaN(max) ? NaN : (min + max) / 2;
};

export function availableSampleCount(data) {
  return Math.min(Number(data?.count || 0), Number(data?.samples?.length || 0) / 2);
}

export function latestWindowStart(data, windowSamples) {
  const depth = data.samples.length / 2;
  return ((data.writeIndex - windowSamples) % depth + depth) % depth;
}

export function findTriggerIndex(data, mode, level) {
  if (!data || mode === 'off') return null;
  const depth = data.samples.length / 2;
  const count = availableSampleCount(data);
  if (count < 2) return null;
  const oldest = ((data.writeIndex - count) % depth + depth) % depth;
  let previous = midpoint(data.samples, oldest);
  let found = null;
  for (let offset = 1; offset < count; offset++) {
    const index = (oldest + offset) % depth;
    const value = midpoint(data.samples, index);
    if (!Number.isNaN(previous) && !Number.isNaN(value)) {
      const crossed = mode === 'rising' ? previous < level && value >= level :
        previous > level && value <= level;
      if (crossed) found = index;
    }
    previous = value;
  }
  return found;
}

export function triggeredWindowStart(data, windowSamples, triggerIndex, pretriggerFraction = 0.25) {
  if (triggerIndex === null) return latestWindowStart(data, windowSamples);
  const depth = data.samples.length / 2;
  const before = Math.floor(windowSamples * pretriggerFraction);
  return ((triggerIndex - before) % depth + depth) % depth;
}

export function cursorDeltaSeconds(sampleIntervalNs, windowSamples, cursorA, cursorB) {
  return Number(sampleIntervalNs) * windowSamples * Math.abs(cursorB - cursorA) / 1e9;
}
