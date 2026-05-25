import { z } from 'zod';
import {
  getSettings,
  SettingsSchema,
  setSettings,
  type Settings,
} from '@/lib/settings';

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
  const parsed = SettingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_settings', issues: z.treeifyError(parsed.error) },
      { status: 422 },
    );
  }
  const saved = await setSettings(parsed.data);
  return Response.json(saved satisfies Settings);
}
