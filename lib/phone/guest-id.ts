'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'aidj_guest_id';

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (older WebViews): RFC4122-ish v4 from Math.random.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns the device's persistent guest UUID. Generates one on first use and
 * stores it in localStorage. Cache-clear → new identity, that's fine for a
 * house party (see PLAN.md "Gast-Track-Submission").
 *
 * SSR-safe: returns null until the client hydrates and localStorage is reachable.
 */
export function useGuestId(): string | null {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const existing = window.localStorage.getItem(STORAGE_KEY);
      if (existing) {
        setId(existing);
        return;
      }
      const fresh = generateUuid();
      window.localStorage.setItem(STORAGE_KEY, fresh);
      setId(fresh);
    } catch {
      // localStorage blocked (private mode, quota) → fall back to volatile ID.
      setId(generateUuid());
    }
  }, []);

  return id;
}
