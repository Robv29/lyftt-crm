import { useState, useEffect } from 'react';

/**
 * État persistant : identique à useState, mais la valeur est conservée
 * dans le navigateur. Les filtres restent donc actifs même après avoir
 * quitté le CRM ou rechargé la page.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* stockage indisponible : on ignore */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
