// GET /api/f3/contracts — the caller's projects with their contract (MOU), read-only.
// The MOU itself is made in the partner portal; the database checks who may see which project.
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors } from '../../../services/f2Api';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;
    const { data, error } = await caller.client.rpc('f3_my_contracts');
    if (error) return sendRpcError(res, error);
    return res.status(200).json({ success: true, contracts: data || [] });
}

export default withJsonErrors(handler);
