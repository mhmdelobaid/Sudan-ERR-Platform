// Superadmin: national projects (each one is a working group), the states each is open to, and its members.
// GET  /api/fund-projects/admin                       — projects, working-group accounts, states
// POST /api/fund-projects/admin {action: 'save', id?, name_en, name_ar, accepts_f1, is_active, states[]}
// POST /api/fund-projects/admin {action: 'member_set', group_id, user_id, function, is_lead}
// POST /api/fund-projects/admin {action: 'member_remove', group_id, user_id}
// POST /api/fund-projects/admin {action: 'move_f1', project_id, group_id}
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors } from '../../../services/f2Api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown) => typeof v === 'string' && UUID_RE.test(v);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
    const caller = await getCaller(req, res);
    if (!caller) return;
    if (caller.appUser.role !== 'superadmin') return res.status(403).json({ success: false, code: 'superadmin_only' });

    if (req.method === 'GET') {
        const { data, error } = await caller.client.rpc('fund_projects_admin');
        if (error) return sendRpcError(res, error);
        return res.status(200).json({ success: true, ...(data || {}) });
    }

    if (req.method === 'POST') {
        const b = req.body || {};
        let result;
        switch (b.action) {
            case 'save': {
                const states = Array.isArray(b.states) ? b.states.filter((s: unknown) => typeof s === 'string').map((s: string) => s.slice(0, 100)) : [];
                result = await caller.client.rpc('fund_project_save', {
                    p_id: isId(b.id) ? b.id : null,
                    p_name_en: str(b.name_en),
                    p_name_ar: str(b.name_ar),
                    p_accepts_f1: b.accepts_f1 !== false,
                    p_is_active: b.is_active !== false,
                    p_states: states,
                });
                break;
            }
            case 'member_set':
                if (!isId(b.group_id) || !isId(b.user_id)) return res.status(400).json({ success: false, code: 'invalid_request' });
                result = await caller.client.rpc('fund_project_member_set', {
                    p_group_id: b.group_id, p_user_id: b.user_id, p_function: str(b.function, 20), p_is_lead: !!b.is_lead,
                });
                break;
            case 'member_remove':
                if (!isId(b.group_id) || !isId(b.user_id)) return res.status(400).json({ success: false, code: 'invalid_request' });
                result = await caller.client.rpc('fund_project_member_remove', { p_group_id: b.group_id, p_user_id: b.user_id });
                break;
            case 'move_f1':
                if (!isId(b.project_id) || !isId(b.group_id)) return res.status(400).json({ success: false, code: 'invalid_request' });
                result = await caller.client.rpc('fund_project_move_f1', { p_project_id: b.project_id, p_group_id: b.group_id });
                break;
            default:
                return res.status(400).json({ success: false, code: 'invalid_request' });
        }
        if (result.error) return sendRpcError(res, result.error);
        return res.status(200).json({ success: true, id: result.data ?? null });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, code: 'method_not_allowed' });
}

export default withJsonErrors(handler);
