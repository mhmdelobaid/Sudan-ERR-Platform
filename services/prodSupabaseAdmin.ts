import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only service-role client for the F1 / F4 / F5 upload APIs (AI reading, wizards, saving).
 *
 * Launch: there is one database, the launch database (NEXT_PUBLIC_NEW_SUPABASE_URL). This never connects
 * to the old MAG / production database, whatever PROD_* variables are set. Every route that uses it checks
 * the signed-in person and their scope first (services/prodProjectAccess.ts).
 */
function launchServiceCreds(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_NEW_SUPABASE_URL?.trim() || '';
  const key = process.env.SUPABASE_SERVICE_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  if (!url || !key) return null;
  return { url, key };
}

export type ReportingDbTarget = 'launch';

export function getReportingDbTarget(): ReportingDbTarget | null {
  return launchServiceCreds() ? 'launch' : null;
}

export function createReportingSupabaseAdmin(): SupabaseClient {
  const creds = launchServiceCreds();
  if (!creds) throw new Error(REPORTING_DB_NOT_CONFIGURED);
  return createClient(creds.url, creds.key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function isReportingSupabaseConfigured(): boolean {
  return getReportingDbTarget() !== null;
}

/** Same as createReportingSupabaseAdmin (kept for the existing F1/F4/F5 callers). Launch database only. */
export function createProdSupabaseAdmin(): SupabaseClient {
  return createReportingSupabaseAdmin();
}

/** Same as isReportingSupabaseConfigured. */
export function isProdSupabaseConfigured(): boolean {
  return isReportingSupabaseConfigured();
}

export const REPORTING_DB_NOT_CONFIGURED =
  'Database not configured. Set NEXT_PUBLIC_NEW_SUPABASE_URL and SUPABASE_SERVICE_KEY.';
