// POST /api/offline/unlock { items: [eph, ...] } -> { keys: [key | null, ...] }
// Gives the signed-in person the keys of the offline reports and photos THEY sealed, so their phone can send them.
// A key is derived with the caller's own user id: items sealed by someone else come back as useless keys and fail
// to open on the phone. Signed-in, active app users only (an account that was switched off gets nothing).
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAppUser } from '../../../services/requireAppUser';
import { offlineUnlock } from '../../../services/offlineKeys';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const caller = await requireAppUser(req, res);
    if (!caller) return;

    const items: unknown = req.body?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
        return res.status(400).json({ error: 'items must be a list of 1 to 200 entries' });
    }
    res.setHeader('Cache-Control', 'no-store');
    try {
        const keys = items.map((eph) => {
            try {
                return offlineUnlock(String(eph), caller.user.id);
            } catch (e: any) {
                if (e?.code === 'not_configured') throw e;
                return null;
            }
        });
        return res.status(200).json({ keys });
    } catch {
        return res.status(503).json({ error: 'not_configured' });
    }
}
