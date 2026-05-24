'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

type LanUrlResponse = { origin: string | null };

export default function WifiQrCode() {
  const [url, setUrl] = useState<string | null>(null);
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // LAN-Origin vom Server holen. Fallback: window.location.origin
      // (zeigt im Worst Case localhost, aber besser als leerer QR).
      let origin = window.location.origin;
      try {
        const res = await fetch('/api/lan-url', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as LanUrlResponse;
          if (data.origin) origin = data.origin;
        }
      } catch {
        // Netzwerkfehler: Fallback bleibt aktiv.
      }
      if (cancelled) return;

      // Immer auf die Root-URL zeigen: der UA-Sniffer in app/page.tsx
      // schickt Gaeste-Phones nach /phone und Tablets/Desktops nach /tablet.
      const fullUrl = origin + '/';
      setUrl(fullUrl);

      try {
        // PNG-Data-URL statt inline-SVG: iOS Safari rendert via innerHTML
        // eingefuegtes <svg> mit XML-Prolog gerne leer. <img src=data:image/png>
        // ist ueberall robust. 512px Quelle skaliert sauber auf 112px Anzeige.
        const dataUrl = await QRCode.toDataURL(fullUrl, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 512,
          color: { dark: '#000000', light: '#ffffff' },
        });
        if (!cancelled) setPngDataUrl(dataUrl);
      } catch {
        if (!cancelled) setPngDataUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const displayUrl = url ? url.replace(/^https?:\/\//, '') : '';

  return (
    <>
      <aside
        aria-label="QR-Code zum Beitreten"
        className="flex h-full w-auto flex-none items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/80 px-2 py-1 select-none"
      >
        <button
          type="button"
          onClick={() => pngDataUrl && setEnlarged(true)}
          aria-label="QR-Code vergroessern"
          className="flex h-16 w-16 items-center justify-center rounded bg-white p-0.5"
        >
          {pngDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pngDataUrl}
              alt={url ? `QR-Code: ${url}` : 'QR-Code'}
              className="h-full w-full"
            />
          ) : (
            <div className="h-full w-full animate-pulse rounded bg-zinc-200" />
          )}
        </button>
        <div className="flex max-w-[7rem] flex-col items-start gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Mitmachen
          </span>
          <span className="w-full truncate font-mono text-[10px] text-zinc-300">
            {displayUrl || ' '}
          </span>
        </div>
      </aside>

      {enlarged && pngDataUrl && (
        <div
          role="dialog"
          aria-label="QR-Code vergroessert"
          onClick={() => setEnlarged(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black/40 p-8 backdrop-blur-sm select-none"
        >
          <div className="rounded-2xl bg-white p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pngDataUrl}
              alt={url ? `QR-Code: ${url}` : 'QR-Code'}
              className="h-[70vmin] w-[70vmin] max-h-[640px] max-w-[640px]"
            />
          </div>
          {displayUrl && (
            <span className="font-mono text-2xl text-zinc-200">
              {displayUrl}
            </span>
          )}
          <span className="text-sm uppercase tracking-wider text-zinc-400">
            Tippen zum Schliessen
          </span>
        </div>
      )}
    </>
  );
}
