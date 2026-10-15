'use client';

import { useEffect, useState } from 'react';

/**
 * Returns `value` after it has stopped changing for `delayMs`. Used to avoid
 * an API call on every keystroke.
 *
 * @param value - Rapidly changing value
 * @param delayMs - Quiet period before updating
 * @returns The debounced value
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
