import { NextApiRequest, NextApiResponse } from 'next';
import { validateSession } from '../../services/auth';
import { createAuthenticatedClient } from '../../services/createAuthenticatedClient';
import { getAllocationTotals } from '../../services/fundingTotals';
import { getAccessScope } from '../../services/accessScope';

/**
 * Funding Pool API
 * Allocated, Committed, Pending and Remaining across ALL open cycles, one entry per state the user may see:
 * their own state (base / state ERR), their visible states (admin / support), or every state (superadmin).
 * The top-level fields keep the user's own state's figures.
 */
interface StatePool { state: string; allocated: number; committed: number; pending: number; remaining: number; is_own_state: boolean }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ success: false, message: 'No authorization header' });
        }

        const accessToken = authHeader.replace('Bearer ', '');
        const user = await validateSession(accessToken);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (req.method !== 'GET') {
            res.setHeader('Allow', ['GET']);
            return res.status(405).json({ success: false, message: 'Method not allowed' });
        }

        const db = createAuthenticatedClient(accessToken);

        let scope;
        try {
            scope = await getAccessScope(db, user.id);
        } catch (e: any) {
            return res.status(500).json({ success: false, message: 'Failed to fetch user state', error: e.message });
        }
        const userState = scope.ownState;
        const empty = { success: true, user_state: userState, allocated: 0, committed: 0, pending: 0, remaining: 0, states: [] as StatePool[] };

        if (!scope.all && scope.states.length === 0) return res.status(200).json(empty);

        // Open cycles only
        const { data: cycles, error: cyclesError } = await db
            .from('funding_cycles')
            .select('id')
            .eq('status', 'open');
        if (cyclesError) {
            return res.status(500).json({ success: false, message: 'Failed to fetch funding cycles', error: cyclesError.message });
        }
        const cycleIds = (cycles || []).map((c: any) => c.id);
        if (cycleIds.length === 0) return res.status(200).json(empty);

        // State allocations in those cycles (every state for superadmin, otherwise the user's states)
        let allocQuery = db
            .from('cycle_state_allocations')
            .select('id, cycle_id, state_name, amount, decision_no')
            .in('cycle_id', cycleIds);
        if (!scope.all) allocQuery = allocQuery.in('state_name', scope.states);
        const { data: allocations, error: allocError } = await allocQuery;
        if (allocError) {
            return res.status(500).json({ success: false, message: 'Failed to fetch allocations', error: allocError.message });
        }

        // Latest decision per cycle and state
        const latest: Record<string, any> = {};
        (allocations || []).forEach((a: any) => {
            const key = `${a.cycle_id}|${a.state_name}`;
            if (!latest[key] || a.decision_no > latest[key].decision_no) latest[key] = a;
        });
        const latestAllocations = Object.values(latest);

        // State-wide committed / pending totals, the same for every role (see services/fundingTotals.ts)
        let totals;
        try {
            totals = await getAllocationTotals(db, latestAllocations.map((a: any) => a.id));
        } catch (e: any) {
            return res.status(500).json({ success: false, message: 'Failed to fetch project totals', error: e.message });
        }

        const byState: Record<string, StatePool> = {};
        latestAllocations.forEach((a: any) => {
            const s = (byState[a.state_name] ||= { state: a.state_name, allocated: 0, committed: 0, pending: 0, remaining: 0, is_own_state: a.state_name === userState });
            s.allocated += Number(a.amount || 0);
            s.committed += totals[a.id]?.committed || 0;
            s.pending += totals[a.id]?.pending || 0;
        });
        const states = Object.values(byState)
            .map(s => ({ ...s, remaining: s.allocated - s.committed - s.pending }))
            .sort((a, b) => (Number(b.is_own_state) - Number(a.is_own_state)) || a.state.localeCompare(b.state));

        const own = states.find(s => s.is_own_state);
        return res.status(200).json({
            success: true,
            user_state: userState,
            allocated: own?.allocated || 0,
            committed: own?.committed || 0,
            pending: own?.pending || 0,
            remaining: own?.remaining || 0,
            states,
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: 'Unexpected server error', error: error.message });
    }
}
