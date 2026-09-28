import { useEffect, useState } from 'react';
import { narrowScreenNow, subscribeNarrowScreen } from './narrow-screen.js';

/** Live "is this a small screen", re-rendering on rotate and pinch. */
export default function useNarrowScreen () {
  const [narrow, setNarrow] = useState(narrowScreenNow);
  useEffect(() => subscribeNarrowScreen(setNarrow), []);
  return narrow;
}
