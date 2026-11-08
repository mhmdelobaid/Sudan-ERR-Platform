// GET /api/fund-projects            — names of all national projects (labels on F1 views)
// GET /api/fund-projects?room=<id>  — projects that room can request funds from (open, and open in its state)
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors } from '../../../services/f2Api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;
    const room = typeof req.query.room === 'string' ? req.query.room : '';
    if (room && !UUID_RE.test(room)) return res.status(400).json({ success: false, code: 'invalid_room' });
    const { data, error } = room
        ? await caller.client.rpc('fund_projects_for_room', { p_room_id: room })
        : await caller.client.rpc('fund_projects');
    if (error) return sendRpcError(res, error);
    return res.status(200).json({ success: true, projects: Array.isArray(data) ? data : [] });
}

export default withJsonErrors(handler);
