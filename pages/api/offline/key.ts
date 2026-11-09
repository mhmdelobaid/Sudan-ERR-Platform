// GET /api/offline/key -> { key }: the public key phones seal offline reports with (services/offlineKeys.ts).
// Signed-in app users only, so the app doesn't announce itself to strangers.
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAppUser } from '../../../services/requireAppUser';
import { offlinePublicKey } from '../../../services/offlineKeys';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const caller = await requireAppUser(req, res);
    if (!caller) return;
    const key = offlinePublicKey();
    if (!key) return res.status(503).json({ error: 'not_configured' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ key, user_id: caller.user.id });
}
