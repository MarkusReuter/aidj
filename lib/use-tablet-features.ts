'use client';

import { useEffect } from 'react';

/**
 * Aktiviert Fullscreen beim ersten Tap und re-aktiviert ihn, falls der User
 * via Pull-Down-Gesture oder ESC kurzzeitig rauskommt.
 *
 * Browser-Sicherheit: requestFullscreen() braucht eine User-Gesture. Wir
 * lauschen daher auf `pointerdown` (any tap zaehlt) und versuchen den Request
 * jedes Mal -- der Browser blockt selbst, wenn schon Fullscreen aktiv ist.
 */
export function useFullscreenOnTap(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = () => {
      if (document.fullscreenElement) return;
      const el = document.documentElement;
      if (typeof el.requestFullscreen !== 'function') return;
      // Promise.catch fuer den Fall, dass der Browser den Request abweist
      // (z.B. iOS Safari, oder Permission verweigert).
      el.requestFullscreen().catch(() => {
        /* swallow -- user has retry by tapping again */
      });
    };

    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [enabled]);
}

/**
 * Haelt das Display waehrend der Party wach (Wake Lock API).
 *
 * Re-akquiriert das Lock, wenn die Seite wieder sichtbar wird -- Android
 * gibt Wake Locks automatisch frei, sobald die App im Hintergrund ist.
 */
export function useScreenWakeLock(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await next.release().catch(() => {});
          return;
        }
        lock = next;
      } catch {
        /* Permission verweigert oder Battery-Saver aktiv -- ignorieren. */
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !lock) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      lock?.release().catch(() => {});
      lock = null;
    };
  }, [enabled]);
}
