// User management, superadmin only.
// GET  /api/user-management                       — every user + the rooms and states to pick from
// POST /api/user-management { user_id, changes }  — change one user's role, status, room, name or visible states
// The database checks the caller is a superadmin (um_users / um_update_user) and logs every change in audit_logs.
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors, isUuid } from '../../services/f2Api';

const ALLOWED = ['role', 'status', 'err_id', 'display_name', 'can_see_all_states', 'visible_states'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
    const caller = await getCaller(req, res);
    if (!caller) return;

    if (req.method === 'GET') {
        const { data: users, error } = await caller.client.rpc('um_users');
        if (error) return sendRpcError(res, error);

        const [{ data: rooms }, { data: states }] = await Promise.all([
            caller.client.from('emergency_rooms')
                .select('id, name, name_ar, type, err_code, status, states ( state_name, state_name_ar, locality, locality_ar )')
                .order('name'),
            caller.client.from('states').select('state_name, state_name_ar'),
        ]);
        const stateList = Array.from(new Map((states || []).map((s: any) => [s.state_name, { name: s.state_name, name_ar: s.state_name_ar }])).values())
            .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
        return res.status(200).json({
            success: true,
            users: users || [],
            rooms: (rooms || []).map((r: any) => ({
                id: r.id, name: r.name, name_ar: r.name_ar, type: r.type, err_code: r.err_code, status: r.status,
                state: r.states?.state_name || null, state_ar: r.states?.state_name_ar || null,
                locality: r.states?.locality || null, locality_ar: r.states?.locality_ar || null,
            })),
            states: stateList,
        });
    }

    if (req.method === 'POST') {
        const { user_id, changes } = req.body || {};
        if (!isUuid(user_id)) return res.status(400).json({ success: false, code: 'invalid_user_id' });
        if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return res.status(400).json({ success: false, code: 'invalid_changes' });
        const clean: Record<string, unknown> = {};
        Object.keys(changes).forEach(k => { if (ALLOWED.includes(k)) clean[k] = changes[k]; });
        if (Object.keys(clean).length === 0) return res.status(400).json({ success: false, code: 'invalid_changes' });
        const { data, error } = await caller.client.rpc('um_update_user', { p_user_id: user_id, p_changes: clean });
        if (error) return sendRpcError(res, error);
        return res.status(200).json({ success: true, user: data });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, code: 'method_not_allowed' });
}

export default withJsonErrors(handler);
