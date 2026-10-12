// GET  /api/wg/project?id=<uuid>  — one project as its working groups see it (F-1, F-2, LCC, F-4, F-5, comments)
// POST /api/wg/project?id=<uuid>  — { action: 'comment', topic, body }
//                                   (LCC approval is switched off for now, 12 Oct 2026)
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors, lineNames, isUuid } from '../../../services/f2Api';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    const caller = await getCaller(req, res);
    if (!caller) return;
    const id = String(req.query.id || '');
    if (!isUuid(id)) return res.status(400).json({ success: false, code: 'invalid_project_id' });

    if (req.method === 'GET') {
        const { data, error } = await caller.client.rpc('wg_project', { p_project_id: id });
        if (error) return sendRpcError(res, error);
        const names = await lineNames(caller.client, data?.lines || []);
        return res.status(200).json({ success: true, ...data, ...names });
    }

    if (req.method === 'POST') {
        const body = req.body || {};
        if (body.action === 'comment') {
            const { data, error } = await caller.client.rpc('wg_add_comment', {
                p_project_id: id,
                p_topic: String(body.topic || 'general'),
                p_body: typeof body.body === 'string' ? body.body.slice(0, 4000) : '',
            });
            if (error) return sendRpcError(res, error);
            return res.status(200).json({ success: true, comment: data });
        }
        return res.status(400).json({ success: false, code: 'invalid_action' });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, code: 'method_not_allowed' });
}

export default withJsonErrors(handler);
