import { useEffect, useState } from 'react';

function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

export function useLocalStorageState(key, initialValue, normalize = (value) => value) {
  const [state, setState] = useState(() => {
    if (typeof window === 'undefined') {
      return normalize(cloneValue(initialValue));
    }

    const storedValue = window.localStorage.getItem(key);

    if (!storedValue) {
      return normalize(cloneValue(initialValue));
    }

    try {
      return normalize(JSON.parse(storedValue));
    } catch {
      return normalize(cloneValue(initialValue));
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  return [state, setState];
}

