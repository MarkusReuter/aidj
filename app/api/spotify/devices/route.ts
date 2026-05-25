/**
 * Listet aktive Spotify-Connect-Devices. Wird vom Host am Mac genutzt, um vor
 * der Party das Playback-Device zu setzen (Mac+Bluetooth, Sonos, AVR, …).
 */

import { getDevices, SpotifyNotConnectedError } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const devices = await getDevices();
    return Response.json({ devices });
  } catch (err) {
    if (err instanceof SpotifyNotConnectedError) {
      return Response.json({ error: 'not_connected', message: err.message }, { status: 401 });
    }
    return Response.json(
      { error: 'spotify_error', message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
