// GET /api/signatures — what is waiting for the caller's signature (F1, F3, F4, F5) and what they signed recently.
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors } from '../../../services/f2Api';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;
    const { data, error } = await caller.client.rpc('my_signatures');
    if (error) return sendRpcError(res, error);
    return res.status(200).json({ success: true, signatures: data });
}

export default withJsonErrors(handler);
