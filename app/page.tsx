import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { userAgent } from 'next/server';

// Root route: server-side UA sniff, redirect to the right surface.
// - device.type === 'mobile' → /phone (iPhone, Android phones)
// - everything else (tablet, desktop, undefined, smarttv, ...) → /tablet
// iPadOS Safari masquerades as Macintosh since iOS 13, so it lands on /tablet,
// which is the desired host UI.
export default async function Home() {
  const h = await headers();
  const ua = userAgent({ headers: h });
  if (ua.device.type === 'mobile') {
    redirect('/phone');
  }
  redirect('/tablet');
}
