// GET  /api/state-rates                              — every state with its current rate (SDG per 1 USD) and its
//                                                     acknowledgement, plus what the caller may do
// POST /api/state-rates { state, rate }              — the partner sets a state's rate (it applies at once)
// POST /api/state-rates { state, acknowledge: true } — a finance member of a national working group acknowledges it
// Decision 10 Nov 2026. Who may do what is checked in the database (state_rate_set, state_rate_acknowledge).
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors } from '../../services/f2Api';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    const caller = await getCaller(req, res);
    if (!caller) return;
    if (req.method === 'GET') {
        const { data, error } = await caller.client.rpc('state_rates');
        if (error) return sendRpcError(res, error);
        const d: any = data || {};
        return res.status(200).json({
            success: true,
            states: Array.isArray(d.states) ? d.states : [],
            can_set: !!d.can_set,
            can_acknowledge: !!d.can_acknowledge,
        });
    }
    if (req.method === 'POST') {
        const state = typeof req.body?.state === 'string' ? req.body.state.trim() : '';
        if (!state) return res.status(400).json({ success: false, code: 'state_not_found' });
        if (req.body?.acknowledge === true) {
            const { data, error } = await caller.client.rpc('state_rate_acknowledge', { p_state: state });
            if (error) return sendRpcError(res, error);
            return res.status(200).json({ success: true, rate: data });
        }
        const rate = Number(String(req.body?.rate ?? '').replace(/,/g, ''));
        if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ success: false, code: 'invalid_rate' });
        const { data, error } = await caller.client.rpc('state_rate_set', { p_state: state, p_rate: rate });
        if (error) return sendRpcError(res, error);
        return res.status(200).json({ success: true, rate: data });
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, code: 'method_not_allowed' });
}

export default withJsonErrors(handler);
