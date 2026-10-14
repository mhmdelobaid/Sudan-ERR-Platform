// GET /api/f2/queue — F-1s waiting for the reps' F-2 decision (plus ones already decided)
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors } from '../../../services/f2Api';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;

    const { data, error } = await caller.client.rpc('f2_queue');
    if (error) return sendRpcError(res, error);
    // F1s from the rep's own locality: shown, but the rep can't vote on them
    const { data: own } = await caller.client.rpc('f2_own_locality_ids');
    const ownIds = new Set<string>((Array.isArray(own) ? own : []).map(String));
    const projects = (data || []).map((p: any) => ({ ...p, own_locality: ownIds.has(String(p.id)) }));
    return res.status(200).json({ success: true, projects });
}

export default withJsonErrors(handler);
