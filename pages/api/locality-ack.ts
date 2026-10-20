// POST /api/locality-ack  { project_id }  — the locality acknowledges an F1 from one of its rooms ("تم الاطلاع").
// It doesn't block anything: the F1 reaches the state and the reps' F2 either way.
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors, isUuid } from '../../services/f2Api';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;
    const id = String(req.body?.project_id || '');
    if (!isUuid(id)) return res.status(400).json({ success: false, code: 'invalid_project_id' });
    const { data, error } = await caller.client.rpc('locality_ack', { p_project_id: id });
    if (error) return sendRpcError(res, error);
    return res.status(200).json({ success: true, ack: data });
}

export default withJsonErrors(handler);
