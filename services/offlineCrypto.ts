// Browser side of sealing offline reports (decision 10 Nov 2026: offline reports stay on the phone, encrypted).
// See services/offlineKeys.ts for the server side.
//
//   seal:   fresh ECDH P-256 pair on the phone + the server's public key -> shared secret
//           -> HKDF-SHA-256 (salt: the fresh public key, info: "err-offline-v1|<owner id>") -> AES-256-GCM key.
//           The phone keeps the fresh PUBLIC key with the sealed data and throws the private half away, so it
//           can't open what it sealed.
//   open:   the signed-in owner asks /api/offline/unlock for the same AES key, then decrypts here.
//
// The only thing kept for sealing is the server's public key (localStorage, SEAL_KEY_STORE). If it isn't there yet
// (never signed in online on this phone) or the browser has no WebCrypto, reports are kept as before and sealed as
// soon as the key arrives (services/offlineReports.ts: sealWaitingReports).
import { newSupabase } from './newSupabaseClient';

export const SEAL_KEY_STORE = 'offlineSealKey';
const INFO_PREFIX = 'err-offline-v1|';

export interface SealedText { v: 1; eph: string; iv: string; data: string }        // data: base64
export interface SealedBytes { v: 1; eph: string; iv: string; data: ArrayBuffer }  // kept as bytes in IndexedDB

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}
function fromB64(b64: string): Uint8Array {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null);

function storedKey(): { key: string; user_id: string } | null {
    try {
        const v = JSON.parse(localStorage.getItem(SEAL_KEY_STORE) || 'null');
        return v && typeof v.key === 'string' && typeof v.user_id === 'string' ? v : null;
    } catch {
        return null;
    }
}

/** True when this phone can seal (it has the server's public key and WebCrypto). */
export function canSeal(): boolean {
    return !!(subtle() && storedKey());
}

/** The person the phone seals for (the last account that fetched the key on this phone). */
export const sealOwner = (): string | null => storedKey()?.user_id ?? null;

/** Fetch and keep the server's public key. Call while online and signed in. */
export async function fetchSealKey(accessToken: string): Promise<boolean> {
    try {
        const res = await fetch('/api/offline/key', { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) return false;
        const body = await res.json();
        if (typeof body?.key !== 'string' || typeof body?.user_id !== 'string') return false;
        localStorage.setItem(SEAL_KEY_STORE, JSON.stringify({ key: body.key, user_id: body.user_id }));
        return true;
    } catch {
        return false;
    }
}

async function freshKey(): Promise<{ key: CryptoKey; eph: string }> {
    const s = subtle();
    const stored = storedKey();
    if (!s || !stored) throw new Error('cannot_seal');
    const serverPub = await s.importKey('raw', fromB64(stored.key), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const pair = await s.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const ephRaw = new Uint8Array(await s.exportKey('raw', pair.publicKey));
    const shared = await s.deriveBits({ name: 'ECDH', public: serverPub }, pair.privateKey, 256);
    const hk = await s.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const key = await s.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: ephRaw, info: enc.encode(INFO_PREFIX + stored.user_id) },
        hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );
    return { key, eph: toB64(ephRaw) };
}

export async function sealBytes(bytes: ArrayBuffer): Promise<SealedBytes> {
    const { key, eph } = await freshKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await subtle()!.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { v: 1, eph, iv: toB64(iv), data };
}

export async function sealText(value: unknown): Promise<SealedText> {
    const sealed = await sealBytes(enc.encode(JSON.stringify(value)).buffer as ArrayBuffer);
    return { ...sealed, data: toB64(new Uint8Array(sealed.data)) };
}

/** Ask the server for the keys of these sealed items (signed-in owner only). */
async function unlock(ephs: string[]): Promise<Array<CryptoKey | null>> {
    const { data: { session } } = await newSupabase.auth.getSession();
    if (!session) throw Object.assign(new Error('not_signed_in'), { code: 'not_signed_in' });
    const res = await fetch('/api/offline/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ items: ephs }),
    });
    if (!res.ok) throw Object.assign(new Error(`unlock_${res.status}`), { code: res.status === 401 ? 'not_signed_in' : 'unlock_failed' });
    const body = await res.json();
    const s = subtle()!;
    return Promise.all((body.keys || []).map((k: string | null) =>
        k ? s.importKey('raw', fromB64(k), { name: 'AES-GCM' }, false, ['decrypt']) : null));
}

/** Decrypt sealed items. Throws code 'no_access' if they were sealed by another account. */
async function openRaw(items: Array<{ eph: string; iv: string; data: ArrayBuffer }>): Promise<ArrayBuffer[]> {
    if (items.length === 0) return [];
    const keys = await unlock(items.map(i => i.eph));
    const s = subtle()!;
    return Promise.all(items.map(async (item, n) => {
        const key = keys[n];
        if (!key) throw Object.assign(new Error('no_access'), { code: 'no_access' });
        try {
            return await s.decrypt({ name: 'AES-GCM', iv: fromB64(item.iv) }, key, item.data);
        } catch {
            // A wrong key (another account's report) fails the GCM check
            throw Object.assign(new Error('no_access'), { code: 'no_access' });
        }
    }));
}

export async function openText<T>(sealed: SealedText): Promise<T> {
    const [buf] = await openRaw([{ ...sealed, data: fromB64(sealed.data).buffer as ArrayBuffer }]);
    return JSON.parse(dec.decode(buf)) as T;
}

export async function openBytes(sealed: SealedBytes): Promise<ArrayBuffer> {
    const [buf] = await openRaw([sealed]);
    return buf;
}
