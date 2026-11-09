// GET  /api/state-rates                    — every state with its current rate (SDG per 1 USD), for any active account
// POST /api/state-rates { state, rate }    — set a state's rate: admins and superadmins only (checked in the database)
// Decision 10 Nov 2026: the exchange rate is set at state level by admins; the F1 has no rate field.
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors } from '../../services/f2Api';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    const caller = await getCaller(req, res);
    if (!caller) return;
    if (req.method === 'GET') {
        const { data, error } = await caller.client.rpc('state_rates');
        if (error) return sendRpcError(res, error);
        return res.status(200).json({ success: true, states: Array.isArray(data) ? data : [] });
    }
    if (req.method === 'POST') {
        const state = typeof req.body?.state === 'string' ? req.body.state.trim() : '';
        const rate = Number(String(req.body?.rate ?? '').replace(/,/g, ''));
        if (!state) return res.status(400).json({ success: false, code: 'state_not_found' });
        if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ success: false, code: 'invalid_rate' });
        const { data, error } = await caller.client.rpc('state_rate_set', { p_state: state, p_rate: rate });
        if (error) return sendRpcError(res, error);
        return res.status(200).json({ success: true, rate: data });
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, code: 'method_not_allowed' });
}

export default withJsonErrors(handler);
