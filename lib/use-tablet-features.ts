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
    if (typeof navigator === 'undefined') return;

    const hasWakeLock = 'wakeLock' in navigator;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (!hasWakeLock) return;
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

    // Fallback fuer Non-Secure-Contexts (z.B. http://mac.local:3000 auf dem iPad):
    // Ein verstecktes, stummes Loop-Video haelt iOS/Android davon ab, den Screen
    // zu dimmen. Browser-Autoplay-Policy zwingt uns, play() bei einem User-Gesture
    // anzustossen -- wir haengen uns daher an pointerdown.
    let video: HTMLVideoElement | null = null;
    let gestureHandler: (() => void) | null = null;

    if (!hasWakeLock) {
      video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      video.muted = true;
      video.loop = true;
      video.style.position = 'fixed';
      video.style.width = '1px';
      video.style.height = '1px';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      // 1s schwarzes MP4 (H.264, baseline, ohne Audio), Base64-inline.
      // Klein genug, dass es im Bundle nicht stoert; loop=true reicht fuer Dauer.
      video.src =
        'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAr5tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0MiByMjQ5NSBkZmYxYzVjIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNCAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTUgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1obWUgc3VibWU9OCBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MiA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTYgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MiBiX2JpYXM9MCBkaXJlY3Q9MyB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAtZYiEACD/2lu4PtiAGCZiIJmO35BneLS4/AKawbwF3gS81VgCN/Hryek5EZJp1IoIhMxooCovsuOgvOuRMowSt+YIA1IL9d8e3xnsPshOEEACAAB1bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAABRnRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAACAAAAAYAAAAAAAJGVkdHMAAAAcZWxzdAAAAAAAAAABAAAD6AAAAAAAAQAAAAAAvm1kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAQAAAAEAAFcQAAAAAACdoZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAW1taW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAEsc3RibAAAAJhzdHNkAAAAAAAAAAEAAACIYXZjMQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAACAAGAASAAAAEgAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//8AAAAyYXZjQwFkAAr/4QAZZ2QACqzZQoF/llhAAAADAEAAAAwDxgxlgAEABmjr48siwAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAALCAAAAAQAAABRzdGNvAAAAAAAAAAEAAAAsAAAAYHVkdGEAAABYbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAraWxzdAAAACOpdG9vAAAAG2RhdGEAAAABAAAAAExhdmY1Ni40MC4xMDE=';

      document.body.appendChild(video);

      gestureHandler = () => {
        // play() liefert ein Promise -- ignorieren, falls der Browser ablehnt;
        // beim naechsten Tap kommt automatisch ein neuer Versuch.
        video?.play().catch(() => {});
      };
      document.addEventListener('pointerdown', gestureHandler);
      // Erstversuch ohne Gesture (manche Browser erlauben muted-autoplay).
      video.play().catch(() => {});
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      lock?.release().catch(() => {});
      lock = null;
      if (gestureHandler) {
        document.removeEventListener('pointerdown', gestureHandler);
      }
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      }
    };
  }, [enabled]);
}
