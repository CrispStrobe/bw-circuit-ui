// SPDX-License-Identifier: MIT
import React, {useEffect, useRef} from 'react';

export function Kim1Video({device, memoryCard}) {
  const ref = useRef(null);
  useEffect(() => {
    const context = ref.current.getContext('2d');
    const frame = context.createImageData(320, 200);
    const previous = new Uint8Array(8000);
    let first = true;
    const render = () => {
      let changed = first;
      for (let i = 0; i < previous.length; i++) {
        const address = device.address + i;
        const value = memoryCard?.type[address] ? memoryCard.data[address] : device.data[address];
        if (!first && value === previous[i]) continue;
        changed = true;
        previous[i] = value;
        for (let bit = 0; bit < 8; bit++) {
          const offset = (i * 8 + bit) * 4;
          const light = value & (1 << bit) ? 238 : 16;
          frame.data.set([light, light, light, 255], offset);
        }
      }
      first = false;
      if (changed) context.putImageData(frame, 0, 0);
    };
    render();
    const timer = setInterval(render, 80);
    return () => clearInterval(timer);
  }, [device, memoryCard]);
  return <canvas ref={ref} className="kim1-video" width={320} height={200} role="img" aria-label="K-1008 video" />;
}
