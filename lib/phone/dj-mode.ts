'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'aidj_dj_mode';
const REQUIRED_TAPS = 10;
const TAP_WINDOW_MS = 2000;

export type UseDjModeResult = {
  isDj: boolean;
  registerTap: () => void;
};

/**
 * DJ-mode unlock for the phone. The host taps the app logo 10× within 2s to
 * reveal Mood/Playlist/Anti-Buttons (which guest mode hides). Toggling fires
 * after every 10th qualifying tap → re-tap to leave DJ mode.
 *
 * State is persisted in localStorage["aidj_dj_mode"] so the mode survives a
 * page refresh. No server-side check — intentional low-friction design for
 * house-party use (see PLAN.md "Out of Scope").
 */
export function useDjMode(): UseDjModeResult {
  const [isDj, setIsDj] = useState(false);
  const tapTimestamps = useRef<number[]>([]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === '1') setIsDj(true);
    } catch {
      // localStorage blocked → start in user mode, no persistence.
    }
  }, []);

  const registerTap = useCallback(() => {
    const now = Date.now();
    const window_ = tapTimestamps.current.filter((t) => now - t < TAP_WINDOW_MS);
    window_.push(now);
    if (window_.length >= REQUIRED_TAPS) {
      tapTimestamps.current = [];
      setIsDj((prev) => {
        const next = !prev;
        try {
          if (next) globalThis.localStorage?.setItem(STORAGE_KEY, '1');
          else globalThis.localStorage?.removeItem(STORAGE_KEY);
        } catch {
          // ignore storage failure
        }
        return next;
      });
    } else {
      tapTimestamps.current = window_;
    }
  }, []);

  return { isDj, registerTap };
}
