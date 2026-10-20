// Server side: only signed-in, active app users may call a route (used by the scan and F4 submit routes,
// which call paid AI services or write reports). Answers 401 itself and returns null when the caller isn't allowed.
import type { NextApiRequest, NextApiResponse } from 'next';
import { validateSession } from './auth';

export async function requireAppUser(req: NextApiRequest, res: NextApiResponse) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return null;
    }
    try {
        const user = await validateSession(token);
        if (!user) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return null;
        }
        return { user, token };
    } catch (e: any) {
        console.error('requireAppUser:', e?.message);
        res.status(503).json({ success: false, error: 'Auth check failed' });
        return null;
    }
}
