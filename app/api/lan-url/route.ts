import os from 'node:os';

export const dynamic = 'force-dynamic';

// Findet die erste nicht-interne IPv4-Adresse — bevorzugt RFC1918 private LANs.
// Filtert typische virtuelle Interfaces (Docker, VPN, VirtualBox) heraus,
// damit der QR-Code wirklich die WLAN-IP zeigt.
function findLanIp(): string | null {
  const ifaces = os.networkInterfaces();
  const candidates: { name: string; address: string }[] = [];

  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    // Bekannte virtuelle Interfaces ueberspringen.
    if (/^(docker|br-|veth|vbox|vmnet|utun|tun|tap|lo|awdl|llw|bridge)/i.test(name)) {
      continue;
    }
    for (const iface of list) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const addr = iface.address;
      // Nur RFC1918 private Adressen (192.168/16, 10/8, 172.16/12).
      const isPrivate =
        addr.startsWith('192.168.') ||
        addr.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(addr);
      if (isPrivate) candidates.push({ name, address: addr });
    }
  }

  // Auf macOS ist en0 ueblicherweise das WLAN — bevorzugen.
  const preferred = candidates.find((c) => /^en0$/i.test(c.name));
  return preferred?.address ?? candidates[0]?.address ?? null;
}

export async function GET(request: Request) {
  const ip = findLanIp();
  if (!ip) {
    return Response.json({ origin: null });
  }
  // Port aus dem Host-Header uebernehmen — bleibt damit konfigurierbar.
  const hostHeader = request.headers.get('host') ?? '';
  const portMatch = /:(\d+)$/.exec(hostHeader);
  const port = portMatch?.[1];
  const origin = port ? `http://${ip}:${port}` : `http://${ip}`;
  return Response.json({ origin });
}
