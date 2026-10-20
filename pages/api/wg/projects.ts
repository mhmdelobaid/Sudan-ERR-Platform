// GET /api/wg/projects — projects run by the caller's working groups (role lcc_wg)
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors, localityAcks } from '../../../services/f2Api';
import { isComingState } from '../../../services/comingStates';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;
    const { data, error } = await caller.client.rpc('wg_projects');
    if (error) return sendRpcError(res, error);
    // Coming states (not yet in the programme) are not shown
    const projects = (Array.isArray(data) ? data : []).filter((p: any) => !isComingState(p?.state));
    const acks = await localityAcks(caller.client, projects.map((p: any) => String(p.id)));
    return res.status(200).json({ success: true, projects: projects.map((p: any) => ({ ...p, locality_ack: acks[String(p.id)] || null })) });
}

export default withJsonErrors(handler);
