import { z } from 'zod';
import {
  getSettings,
  SettingsSchema,
  setSettings,
  type Settings,
} from '@/lib/settings';
import { applyFilterMode } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const settings = await getSettings();
  return Response.json(settings satisfies Settings);
}

export async function PUT(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }
  // Partial-Update: Clients schicken nur das Feld, das sie ändern
  // (CooldownSetting → cooldownMinutes, FilterModeSetting → antiFilterMode).
  // Wir mergen über den aktuellen Stand, sonst würde ein Single-Field-PUT die
  // anderen Felder auf ihre Defaults zurücksetzen.
  const parsed = SettingsSchema.partial().safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_settings', issues: z.treeifyError(parsed.error) },
      { status: 422 },
    );
  }
  const current = await getSettings();
  const saved = await setSettings({ ...current, ...parsed.data });
  // Filter-Modus-Wechsel an den Party-State durchreichen: aktive Filter leeren
  // (Playlist- vs Genre-Labels sind verschiedene Wertebereiche) + SSE-Push.
  if (parsed.data.antiFilterMode !== undefined) {
    applyFilterMode(saved.antiFilterMode);
  }
  return Response.json(saved satisfies Settings);
}
