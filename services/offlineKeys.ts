// Server only. The key that seals reports saved in offline mode (services/offlineCrypto.ts, decision 10 Nov 2026).
//
// - The phone seals each report and each receipt photo with a fresh key it agrees with this server's public key
//   (ECDH P-256 + HKDF-SHA-256 -> AES-256-GCM). The phone keeps only the server's PUBLIC key, so whatever is on
//   the phone can't be read on the phone: not by someone searching it, and not by a copy of its storage.
// - Opening needs this server and the signed-in owner: the per-item key is derived with the owner's user id,
//   so another account gets a different (useless) key.
// - The private key is derived from OFFLINE_REPORTS_SECRET (if set) or else the launch database's service-role key,
//   which only the server has. Changing that secret makes reports sealed before the change unreadable, so send
//   everything waiting on the phones first.
import { createECDH, hkdfSync, type ECDH } from 'crypto';

const INFO_PREFIX = 'err-offline-v1|';
let cached: { ecdh: ECDH; pub: string } | null = null;

function masterSecret(): string | null {
    const s =
        process.env.OFFLINE_REPORTS_SECRET?.trim() ||
        process.env.NEW_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
        process.env.SUPABASE_SERVICE_KEY?.trim() ||
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    return s || null;
}

function serverKey(): { ecdh: ECDH; pub: string } | null {
    if (cached) return cached;
    const m = masterSecret();
    if (!m) return null;
    for (let i = 0; i < 16; i++) {
        const d = Buffer.from(hkdfSync('sha256', m, 'err-offline-reports', `p256-private-v1|${i}`, 32));
        try {
            const ecdh = createECDH('prime256v1');
            ecdh.setPrivateKey(d); // throws in the (very rare) case d is not a valid P-256 scalar
            cached = { ecdh, pub: ecdh.getPublicKey().toString('base64') };
            return cached;
        } catch {
            /* try the next counter */
        }
    }
    return null;
}

/** The public key phones seal with (65-byte uncompressed P-256 point, base64). Null when the server has no secret. */
export function offlinePublicKey(): string | null {
    return serverKey()?.pub ?? null;
}

/** The AES-256 key (base64) for one sealed item, for its owner only. Throws on a malformed item. */
export function offlineUnlock(ephB64: string, ownerId: string): string {
    const k = serverKey();
    if (!k) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
    const eph = Buffer.from(String(ephB64 || ''), 'base64');
    if (eph.length !== 65 || eph[0] !== 4) throw Object.assign(new Error('bad_item'), { code: 'bad_item' });
    const shared = k.ecdh.computeSecret(eph); // throws if the point isn't on the curve
    return Buffer.from(hkdfSync('sha256', shared, eph, INFO_PREFIX + ownerId, 32)).toString('base64');
}
