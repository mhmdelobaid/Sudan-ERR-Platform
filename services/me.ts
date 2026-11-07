// The signed-in person, looked up once per page load and shared by the app shell, home and the pages
// (one /api/validate-session call instead of one per component).
import { newSupabase } from './newSupabaseClient';

export interface Me {
  id: string;
  email?: string;
  role: string;
  status?: string;
  display_name?: string | null;
}

let cached: { token: string; promise: Promise<Me | null> } | null = null;

export async function getMe(): Promise<{ me: Me | null; token: string | null }> {
  const { data: { session } } = await newSupabase.auth.getSession();
  if (!session) return { me: null, token: null };
  const token = session.access_token;
  if (!cached || cached.token !== token) {
    const promise = fetch('/api/validate-session', {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return null;
        const d = await r.json();
        return d?.success ? (d.user as Me) : null;
      })
      .catch(() => null);
    cached = { token, promise };
    // A failed lookup is not kept, so the next page tries again
    promise.then((m) => { if (!m && cached?.promise === promise) cached = null; });
  }
  return { me: await cached.promise, token };
}

/** Roles that run a room (F1, F3, F4, F5, offline mode). State reps and working groups don't. */
export const isRoomRole = (role?: string | null) => !!role && !['state_rep', 'lcc_wg'].includes(role);
