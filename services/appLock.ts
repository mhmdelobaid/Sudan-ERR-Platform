// The calculator lock and sign-out (security audit H1).
//
// - Unlocking: entering the calculator code sets a flag in sessionStorage. It lasts until the tab or the
//   installed app is closed, then the calculator code is needed again.
// - Every page except the calculator itself and the "set new password" link page needs that flag
//   (see LockGate in _app.tsx), so typing /menu in the address bar shows the calculator.
// - Signing out ends the session on the server for this device, removes the login from the phone and
//   returns to the calculator. Forms saved offline and not yet sent are kept, so no report is lost.
import { newSupabase } from './newSupabaseClient';

const UNLOCK_KEY = 'isUnlocked';

// Pages that open without the calculator code: the calculator, and the password link from an email.
const OPEN_PATHS = ['/', '/update-password', '/404', '/_error'];

export const isOpenPath = (pathname: string) => OPEN_PATHS.includes(pathname);

export function isUnlocked(): boolean {
    try { return sessionStorage.getItem(UNLOCK_KEY) === 'true'; } catch { return false; }
}

export function setUnlocked() {
    try { sessionStorage.setItem(UNLOCK_KEY, 'true'); } catch { /* private mode: stays locked */ }
}

/** Back to the calculator without signing out. */
export function lock() {
    try {
        sessionStorage.removeItem(UNLOCK_KEY);
        sessionStorage.removeItem('fromInternalPage');
    } catch { /* ignore */ }
}

// Left on the phone after sign-out: forms saved offline that haven't been sent yet.
const KEEP_KEYS = ['offlineSessionQueue', 'offlineQueue', 'i18nextLng'];

/** Remove every copy of the login and other personal data from this browser. */
function clearLocalData() {
    try {
        const remove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || KEEP_KEYS.includes(k)) continue;
            // Supabase sessions (sb-<project>-auth-token, code verifiers), the old duplicate copy the
            // login page used to write, scan prefill data, and the list of forms already sent.
            if (k.startsWith('sb-') || k.startsWith('supabase.') || k === 'prefillData'
                || k === 'offlineSubmittedQueue' || k === 'offlineSubmissionSuccess') remove.push(k);
        }
        remove.forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }
}

/**
 * Sign out on this device: end the session on the server (when online), clear the login from the phone,
 * and reload on the calculator so nothing from the last screen stays in memory.
 */
export async function signOutAndLock(): Promise<void> {
    try {
        // 'local' ends only this device's session; other devices of the same person stay signed in.
        // Offline, this call fails and the local copy is still removed below (the token expires within the hour).
        await Promise.race([
            newSupabase.auth.signOut({ scope: 'local' }),
            new Promise(resolve => setTimeout(resolve, 4000)),
        ]);
    } catch { /* still clear locally */ }
    clearLocalData();
    window.location.replace('/');
}
