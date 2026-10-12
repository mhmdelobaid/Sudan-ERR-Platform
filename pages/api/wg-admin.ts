// Admin screen for working groups (admin / superadmin only; the database checks the role).
// GET  /api/wg-admin?view=groups
// GET  /api/wg-admin?view=projects&search=&status=
// POST /api/wg-admin  { action: 'create_group', name_en, name_ar }
//                     { action: 'add_member', group_id, email, is_lead }
//                     { action: 'remove_member', group_id, user_id }
//                     { action: 'set_project_groups', project_id, group_ids: [], program_lead }
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors, isUuid } from '../../services/f2Api';

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
    const caller = await getCaller(req, res);
    if (!caller) return;
    const db = caller.client;

    if (req.method === 'GET') {
        if (req.query.view === 'projects') {
            const { data, error } = await db.rpc('wga_projects', {
                p_search: str(req.query.search) || null,
                p_status: str(req.query.status, 40) || null,
            });
            if (error) return sendRpcError(res, error);
            return res.status(200).json({ success: true, projects: data || [] });
        }
        const { data, error } = await db.rpc('wga_groups');
        if (error) return sendRpcError(res, error);
        return res.status(200).json({ success: true, groups: data || [] });
    }

    if (req.method === 'POST') {
        const b = req.body || {};
        let result;
        switch (b.action) {
            case 'create_group':
                result = await db.rpc('wga_create_group', { p_name_en: str(b.name_en), p_name_ar: str(b.name_ar) });
                break;
            case 'add_member':
                if (!isUuid(b.group_id)) return res.status(400).json({ success: false, code: 'invalid_request' });
                result = await db.rpc('wga_add_member', { p_group_id: b.group_id, p_email: str(b.email, 320), p_is_lead: b.is_lead === true });
                break;
            case 'remove_member':
                if (!isUuid(b.group_id) || !isUuid(b.user_id)) return res.status(400).json({ success: false, code: 'invalid_request' });
                result = await db.rpc('wga_remove_member', { p_group_id: b.group_id, p_user_id: b.user_id });
                break;
            case 'set_project_groups': {
                const ids = Array.isArray(b.group_ids) ? b.group_ids.filter(isUuid) : [];
                if (!isUuid(b.project_id) || (b.program_lead != null && !isUuid(b.program_lead))) {
                    return res.status(400).json({ success: false, code: 'invalid_request' });
                }
                result = await db.rpc('wga_set_project_groups', { p_project_id: b.project_id, p_group_ids: ids, p_program_lead: b.program_lead || null });
                break;
            }
            default:
                return res.status(400).json({ success: false, code: 'invalid_action' });
        }
        if (result.error) return sendRpcError(res, result.error);
        return res.status(200).json({ success: true, result: result.data });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, code: 'method_not_allowed' });
}

export default withJsonErrors(handler);
