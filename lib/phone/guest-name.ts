'use client';

import { useCallback, useEffect, useState } from 'react';

const OVERRIDE_KEY = 'aidj_guest_name';

const ADJECTIVES = [
  'Tanzende',
  'Springende',
  'Klatschende',
  'Wilde',
  'Goldene',
  'Funkelnde',
  'Leise',
  'Laute',
  'Geheime',
  'Verträumte',
  'Kosmische',
  'Elektrische',
  'Pinke',
  'Türkise',
  'Glitzernde',
  'Pulsierende',
];

const NOUNS = [
  'Erdbeere',
  'Ananas',
  'Banane',
  'Wolke',
  'Sonne',
  'Welle',
  'Katze',
  'Eule',
  'Pinguin',
  'Drache',
  'Komet',
  'Discokugel',
  'Tröte',
  'Pizza',
  'Mango',
  'Qualle',
];

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function deriveAutoName(seed: string): string {
  const h = hashString(seed);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length];
  return `${adj} ${noun}`;
}

/**
 * Returns the guest's display name. Defaults to a deterministic auto-nickname
 * derived from the guest UUID; the user can override it (persists in
 * localStorage). Clearing the override falls back to the auto-name.
 *
 * SSR-safe: returns null until the client hydrates (matches useGuestId).
 */
export function useGuestName(guestId: string | null): {
  name: string | null;
  isCustom: boolean;
  setName: (next: string) => void;
  resetName: () => void;
} {
  const [override, setOverride] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setOverride(window.localStorage.getItem(OVERRIDE_KEY));
    } catch {
      setOverride(null);
    }
    setHydrated(true);
  }, []);

  const setName = useCallback((next: string) => {
    const trimmed = next.trim().slice(0, 24);
    if (!trimmed) {
      try {
        window.localStorage.removeItem(OVERRIDE_KEY);
      } catch {
        /* ignore */
      }
      setOverride(null);
      return;
    }
    try {
      window.localStorage.setItem(OVERRIDE_KEY, trimmed);
    } catch {
      /* ignore — volatile is fine for one session */
    }
    setOverride(trimmed);
  }, []);

  const resetName = useCallback(() => {
    try {
      window.localStorage.removeItem(OVERRIDE_KEY);
    } catch {
      /* ignore */
    }
    setOverride(null);
  }, []);

  if (!hydrated || !guestId) {
    return { name: null, isCustom: false, setName, resetName };
  }

  return {
    name: override ?? deriveAutoName(guestId),
    isCustom: override !== null,
    setName,
    resetName,
  };
}
