// GET /api/project-file?id=<uuid> — one project's F1 to F5, read-only, for the project file page and its PDF.
// The database decides who may see it (the project's room, locality and state, the state's reps, its
// working groups, admins and support) and leaves out bank details and phone numbers.
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors, lineNames, isUuid, localityAcks } from '../../services/f2Api';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;
    const id = String(req.query.id || '');
    if (!isUuid(id)) return res.status(400).json({ success: false, code: 'invalid_project_id' });

    const { data, error } = await caller.client.rpc('project_file', { p_project_id: id });
    if (error) return sendRpcError(res, error);
    const names = await lineNames(caller.client, data?.lines || []);
    const acks = await localityAcks(caller.client, [id]);
    return res.status(200).json({ success: true, ...data, ...names, locality_ack: acks[id] || null });
}

export default withJsonErrors(handler);
