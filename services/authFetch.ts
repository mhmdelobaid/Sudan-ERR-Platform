// Browser side: fetch that sends the signed-in user's token, for routes that require a login.
import { newSupabase } from './newSupabaseClient';

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
    const { data: { session } } = await newSupabase.auth.getSession();
    const headers = new Headers(init.headers || {});
    if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
    return fetch(input, { ...init, headers });
}
