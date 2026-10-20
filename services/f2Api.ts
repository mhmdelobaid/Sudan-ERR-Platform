// Shared helpers for the F-2 (state reps screening) API routes.
import { NextApiRequest, NextApiResponse } from 'next';
import { newSupabase } from './newSupabaseClient';
import { createAuthenticatedClient } from './createAuthenticatedClient';

/** Resolve the caller from the Bearer token and return a client that runs as them (RLS + auth.uid()). */
export async function getCaller(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.status(401).json({ success: false, code: 'unauthorized' });
        return null;
    }
    const accessToken = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await newSupabase.auth.getUser(accessToken);
    if (error || !user) {
        res.status(401).json({ success: false, code: 'unauthorized' });
        return null;
    }
    return { user, client: createAuthenticatedClient(accessToken) };
  } catch (err: any) {
    // e.g. Supabase unreachable — answer with JSON so the page can show a message, not Next's HTML error page.
    console.error('F-2 auth check failed:', err?.message);
    res.status(503).json({ success: false, code: 'server_error' });
    return null;
  }
}

/** Wrap an API handler so any unexpected throw still returns JSON. */
export function withJsonErrors(handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>) {
    return async (req: NextApiRequest, res: NextApiResponse) => {
        try {
            await handler(req, res);
        } catch (err: any) {
            console.error('F-2 API error:', err?.message);
            if (!res.headersSent) res.status(500).json({ success: false, code: 'server_error' });
        }
    };
}

// Error codes raised by the f2_* database functions -> HTTP status.
const KNOWN_ERRORS: Record<string, number> = {
    // F-2
    only_state_reps_can_vote: 403,
    own_locality: 403,
    // User management (superadmin only)
    only_superadmin: 403,
    cannot_change_self: 403,
    invalid_role: 400,
    invalid_status: 400,
    invalid_changes: 400,
    room_required: 400,
    room_type_mismatch: 400,
    room_not_found: 404,
    // Locality acknowledgement
    only_locality_acknowledges: 403,
    project_not_pending: 409,
    project_has_no_lines: 422,
    invalid_ballot: 400,
    ballot_must_cover_every_line: 400,
    note_required_for_conditional_or_reject: 400,
    // Working groups / LCC
    only_program_working_group_can_decide: 403,
    only_working_groups_confirm: 403,
    lcc_step_off: 403,
    project_not_screened: 409,
    invalid_decision: 400,
    note_required_to_return: 400,
    already_decided: 409,
    comment_empty: 400,
    // Admin
    admins_only: 403,
    name_required: 400,
    user_not_found: 404,
    user_not_lcc_wg: 400,
    program_lead_required: 400,
    not_allowed: 403,
    // keep last: other codes contain it
    not_found: 404,
};

export function sendRpcError(res: NextApiResponse, error: { message?: string }) {
    const code = Object.keys(KNOWN_ERRORS).find(k => (error?.message || '').includes(k));
    if (code) {
        return res.status(KNOWN_ERRORS[code]).json({ success: false, code });
    }
    console.error('F-2 RPC error:', error?.message);
    return res.status(500).json({ success: false, code: 'server_error' });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Readable names for the activity and expense ids stored in F-1 lines (as returned by f2_lines). */
export async function lineNames(client: any, lines: any[]) {
    const activityIds = Array.from(new Set((lines || []).map(l => l.activity_id).filter((x: any) => typeof x === 'string' && UUID_RE.test(x))));
    const expenseIds = Array.from(new Set((lines || []).flatMap(l =>
        l.kind === 'activity' ? (l.expenses || []).map((e: any) => e.expense) : [l.expense_id]
    ).filter((x: any) => typeof x === 'string' && UUID_RE.test(x))));
    const [acts, exps] = await Promise.all([
        activityIds.length
            ? client.from('planned_activities').select('id, activity_name, activity_name_ar').in('id', activityIds)
            : Promise.resolve({ data: [] as any[] }),
        expenseIds.length
            ? client.from('expense_categories').select('id, expense_name').in('id', expenseIds)
            : Promise.resolve({ data: [] as any[] }),
    ]);
    const activityNames: Record<string, { en: string; ar: string }> = {};
    (acts.data || []).forEach((a: any) => { activityNames[a.id] = { en: a.activity_name, ar: a.activity_name_ar || a.activity_name }; });
    const expenseNames: Record<string, string> = {};
    (exps.data || []).forEach((e: any) => { expenseNames[e.id] = e.expense_name; });
    return { activityNames, expenseNames };
}

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Locality acknowledgements ("تم الاطلاع") of the given F1s the caller may see, by project id. Never throws. */
export async function localityAcks(client: any, ids: string[]): Promise<Record<string, { acknowledged_at: string; acknowledged_by_name: string | null }>> {
    const out: Record<string, { acknowledged_at: string; acknowledged_by_name: string | null }> = {};
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return out;
    const { data, error } = await client.rpc('locality_acks', { p_project_ids: unique });
    if (error) { console.error('locality_acks:', error.message); return out; }
    (data || []).forEach((a: any) => { out[String(a.project_id)] = { acknowledged_at: a.acknowledged_at, acknowledged_by_name: a.acknowledged_by_name }; });
    return out;
}
