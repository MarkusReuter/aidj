/**
 * LLM-Provider-Auswahl, geteilt zwischen DJ-Brain ([dj-brain.ts]) und
 * Library-Auto-Tagging ([app/api/library/auto-tag]).
 *
 * Priorität: Google Gemini → Anthropic Claude → null (Caller fällt dann auf
 * seinen jeweiligen Heuristik-/Manual-Pfad zurück).
 *
 * Server-only — importiert die Provider-Packages, die node-spezifische
 * Fetch-Pfade ziehen.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export type LLMProvider = 'google' | 'anthropic';

export type ModelChoice = {
  model: LanguageModel;
  provider: LLMProvider;
  /** Für Logs + UI-Badges — kein semantisches Feld. */
  displayName: string;
};

export function pickModel(): ModelChoice | null {
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (geminiKey) {
    return {
      model: google('gemini-2.5-flash'),
      provider: 'google',
      displayName: 'Gemini 2.5 Flash',
    };
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    return {
      model: anthropic('claude-sonnet-4-6'),
      provider: 'anthropic',
      displayName: 'Claude Sonnet 4.6',
    };
  }
  return null;
}
