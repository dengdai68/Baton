// Minimal shared state for values that cross screens (filters, drafts).
import { useSyncExternalStore } from 'react';

export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((current: T) => T)) {
      value = typeof next === 'function' ? (next as (current: T) => T)(value) : next;
      listeners.forEach((listener) => listener());
    },
    use(): T {
      return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => value);
    },
  };
}

/** Debounce a fast-changing value (search fields). */
import { useEffect, useState } from 'react';
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
