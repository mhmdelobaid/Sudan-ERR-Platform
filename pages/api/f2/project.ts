// GET  /api/f2/project?id=<uuid>  — one F-1 with its lines and every rep's ballot
// POST /api/f2/project?id=<uuid>  — cast or update the caller's ballot { line_votes: [{key, verdict, note}], overall_note }
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors, localityAcks } from '../../../services/f2Api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
    const caller = await getCaller(req, res);
    if (!caller) return;

    const id = String(req.query.id || '');
    if (!UUID.test(id)) {
        return res.status(400).json({ success: false, code: 'invalid_project_id' });
    }

    if (req.method === 'GET') {
        const { data, error } = await caller.client.rpc('f2_project', { p_project_id: id });
        if (error) return sendRpcError(res, error);

        // Attach readable names for the activity and expense ids stored in the F-1.
        const lines: any[] = data?.lines || [];
        const activityIds = Array.from(new Set(lines.map(l => l.activity_id).filter(Boolean)));
        const expenseIds = Array.from(new Set(lines.flatMap(l =>
            l.kind === 'activity' ? (l.expenses || []).map((e: any) => e.expense) : [l.expense_id]
        ).filter((x: any) => typeof x === 'string' && UUID.test(x))));

        const [acts, exps] = await Promise.all([
            activityIds.length
                ? caller.client.from('planned_activities').select('id, activity_name, activity_name_ar').in('id', activityIds)
                : Promise.resolve({ data: [] as any[] }),
            expenseIds.length
                ? caller.client.from('expense_categories').select('id, expense_name').in('id', expenseIds)
                : Promise.resolve({ data: [] as any[] }),
        ]);

        const activityNames: Record<string, { en: string; ar: string }> = {};
        (acts.data || []).forEach((a: any) => {
            activityNames[a.id] = { en: a.activity_name, ar: a.activity_name_ar || a.activity_name };
        });
        const expenseNames: Record<string, string> = {};
        (exps.data || []).forEach((e: any) => { expenseNames[e.id] = e.expense_name; });

        const acks = await localityAcks(caller.client, [id]);
        return res.status(200).json({ success: true, ...data, activityNames, expenseNames, locality_ack: acks[id] || null });
    }

    if (req.method === 'POST') {
        const { line_votes, overall_note } = req.body || {};
        if (!Array.isArray(line_votes)) {
            return res.status(400).json({ success: false, code: 'invalid_ballot' });
        }
        const clean = line_votes.map((v: any) => ({
            key: String(v?.key || ''),
            verdict: String(v?.verdict || ''),
            note: typeof v?.note === 'string' ? v.note.slice(0, 2000) : null,
        }));
        const { data, error } = await caller.client.rpc('f2_cast_vote', {
            p_project_id: id,
            p_line_votes: clean,
            p_overall_note: typeof overall_note === 'string' ? overall_note.slice(0, 4000) : null,
        });
        if (error) return sendRpcError(res, error);
        return res.status(200).json({ success: true, result: data });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, code: 'method_not_allowed' });
}

export default withJsonErrors(handler);
