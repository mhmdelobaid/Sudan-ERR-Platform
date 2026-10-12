// GET /api/wg/projects — projects run by the caller's working groups (role lcc_wg)
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors } from '../../../services/f2Api';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;
    const { data, error } = await caller.client.rpc('wg_projects');
    if (error) return sendRpcError(res, error);
    return res.status(200).json({ success: true, projects: data || [] });
}

export default withJsonErrors(handler);
