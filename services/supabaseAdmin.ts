// Server only. Clients for creating logins and sending password links (User Management import).
import type { NextApiRequest } from 'next';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_NEW_SUPABASE_URL;

/**
 * Admin client with the service role key of the same Supabase project the app uses
 * (NEW_SUPABASE_SERVICE_ROLE_KEY). Returns null when the key isn't set, so routes can say so plainly.
 * Never import this into a page or component.
 */
export function getAdminClient(): SupabaseClient | null {
    const key = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/**
 * Client for asking Supabase to email a password link. It uses the implicit flow: the browser app uses
 * PKCE, whose links only work in the browser that asked for them, and here the server asks for the person.
 */
export function getEmailClient(): SupabaseClient | null {
    const anon = process.env.NEXT_PUBLIC_NEW_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' } });
}

/** The app's own address, for links in emails: NEXT_PUBLIC_SITE_URL if set, else the address of this request. */
export function siteOrigin(req: NextApiRequest): string | null {
    const fixed = process.env.NEXT_PUBLIC_SITE_URL;
    if (fixed && /^https?:\/\/[^/\s]+$/.test(fixed.replace(/\/$/, ''))) return fixed.replace(/\/$/, '');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null;
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
        || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https');
    return `${proto === 'http' ? 'http' : 'https'}://${host}`;
}
