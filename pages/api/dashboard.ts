// Dashboard: basic analysis within what the signed-in user may see
// (own room for base ERR, own state for state ERR, visible states for admin/support, everything for superadmin).
//   GET /api/dashboard
import { NextApiRequest, NextApiResponse } from 'next';
import { validateSession } from '../../services/auth';
import { createAuthenticatedClient } from '../../services/createAuthenticatedClient';
import { getAccessScope, getRoomNames } from '../../services/accessScope';
import { getFundingByState } from '../../services/fundingPool';

const PAGE = 1000;   // Supabase returns at most 1,000 rows per request
const CHUNK = 150;   // ids per ".in()" filter, to keep URLs short

async function fetchAll(build: (from: number, to: number) => any): Promise<any[]> {
    const rows: any[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        rows.push(...(data || []));
        if (!data || data.length < PAGE) return rows;
    }
}

async function fetchByIds(db: any, table: string, select: string, column: string, ids: string[], extra: (q: any) => any = q => q): Promise<any[]> {
    const rows: any[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        rows.push(...await fetchAll((from, to) => extra(db.from(table).select(select).in(column, part)).range(from, to)));
    }
    return rows;
}

const num = (v: any) => {
    const n = typeof v === 'string' ? Number(v.trim()) : Number(v);
    return Number.isFinite(n) ? n : 0;
};
const asArray = (v: any): any[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
    return [];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No authorization header' });
    const user = await validateSession(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const db = createAuthenticatedClient(token);

    try {
        const scope = await getAccessScope(db, user.id);

        // 1) Funding by state (same numbers as the funding screen)
        const funding = await getFundingByState(db, scope);

        // 2) Submitted projects the user may see
        let projects: any[] = [];
        if (scope.all || scope.roomIds.length > 0) {
            const select = 'id, status, funding_status, err_id, state, currency, planned_activities, expenses';
            projects = scope.all
                ? await fetchAll((from, to) => db.from('err_projects').select(select).eq('is_draft', false).range(from, to))
                : await fetchByIds(db, 'err_projects', select, 'err_id', scope.roomIds, q => q.eq('is_draft', false));
        }

        // F-1 work plans started but not yet submitted (drafts): counted only, never in totals or budgets
        let drafts = 0;
        if (scope.all) {
            const { count } = await db.from('err_projects').select('id', { count: 'exact', head: true }).eq('is_draft', true);
            drafts = count || 0;
        } else {
            for (let i = 0; i < scope.roomIds.length; i += CHUNK) {
                const { count } = await db.from('err_projects').select('id', { count: 'exact', head: true })
                    .eq('is_draft', true).in('err_id', scope.roomIds.slice(i, i + CHUNK));
                drafts += count || 0;
            }
        }

        // State of each project comes from its room (err_projects.state may be Arabic or English)
        const rooms = await getRoomNames(db, projects.map(p => String(p.err_id || '')));
        const stateOf = (p: any) => rooms[String(p.err_id)]?.state || p.state || 'Unknown';
        // Locality comes from the project's room (its states row), falling back to the project's own text
        const localityOf = (p: any) => rooms[String(p.err_id)]?.locality || p.locality || 'Unknown';
        const locality_labels_ar: Record<string, string> = {};
        Object.values(rooms).forEach((r: any) => { if (r.locality && r.locality_ar) locality_labels_ar[r.locality] = r.locality_ar; });

        const byStatus: Record<string, number> = {};
        const byState: Record<string, Record<string, number>> = {};
        const byLocality: Record<string, Record<string, Record<string, number>>> = {};   // state -> locality -> status -> count
        projects.forEach(p => {
            const status = p.status || 'unknown';
            byStatus[status] = (byStatus[status] || 0) + 1;
            const st = stateOf(p);
            byState[st] ||= {};
            byState[st][status] = (byState[st][status] || 0) + 1;
            const loc = localityOf(p);
            byLocality[st] ||= {};
            byLocality[st][loc] ||= {};
            byLocality[st][loc][status] = (byLocality[st][loc][status] || 0) + 1;
        });
        const sumCounts = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

        // 3) Planned budgets by activity and by expense type, kept apart per currency (no conversion)
        const budgetByActivity: Record<string, Record<string, number>> = {};   // currency -> activity id -> amount
        const budgetByExpense: Record<string, Record<string, number>> = {};    // currency -> expense id -> amount
        const budgetTotal: Record<string, number> = {};
        projects.forEach(p => {
            const cur = p.currency === 'SDG' ? 'SDG' : 'USD';
            budgetByActivity[cur] ||= {}; budgetByExpense[cur] ||= {};
            asArray(p.planned_activities).forEach((a: any) => {
                const amount = asArray(a?.expenses).reduce((s: number, e: any) => s + num(e?.total ?? e?.total_cost), 0);
                if (!amount) return;
                const key = String(a?.selectedActivity || 'other');
                budgetByActivity[cur][key] = (budgetByActivity[cur][key] || 0) + amount;
            });
            asArray(p.expenses).forEach((e: any) => {
                const amount = num(e?.total_cost ?? e?.total);
                if (!amount) return;
                const key = String(e?.expense || 'other');
                budgetByExpense[cur][key] = (budgetByExpense[cur][key] || 0) + amount;
                budgetTotal[cur] = (budgetTotal[cur] || 0) + amount;
            });
        });

        const [{ data: activityNames }, { data: expenseNames }] = await Promise.all([
            db.from('planned_activities').select('id, activity_name, activity_name_ar'),
            db.from('expense_categories').select('id, expense_name'),
        ]);
        const actName: Record<string, { en: string; ar: string | null }> = {};
        (activityNames || []).forEach((a: any) => { actName[a.id] = { en: a.activity_name, ar: a.activity_name_ar }; });
        const expName: Record<string, string> = {};
        (expenseNames || []).forEach((e: any) => { expName[e.id] = e.expense_name; });

        const toRows = (m: Record<string, number>, name: (id: string) => { en: string; ar: string | null }) =>
            Object.entries(m).map(([id, amount]) => ({ id, ...name(id), amount })).sort((a, b) => b.amount - a.amount);
        const budgets = Object.keys({ ...budgetByActivity, ...budgetByExpense })
            .filter(cur => (budgetTotal[cur] || 0) > 0 || Object.keys(budgetByActivity[cur] || {}).length > 0)
            .sort()
            .map(cur => ({
                currency: cur,
                total: budgetTotal[cur] || 0,
                byActivity: toRows(budgetByActivity[cur] || {}, id => actName[id] || { en: id === 'other' ? 'Other' : id, ar: null }),
                byExpense: toRows(budgetByExpense[cur] || {}, id => ({ en: expName[id] || (id === 'other' ? 'Other' : id), ar: null })),
            }));

        // 4) People reached, from submitted F5 program reports on these projects
        const reports = await fetchByIds(db, 'err_program_report', 'id, project_id', 'project_id', projects.map(p => p.id));
        const reach = await fetchByIds(db, 'err_program_reach',
            'report_id, individual_count, household_count, male_count, female_count, under18_male, under18_female, people_with_disabilities',
            'report_id', reports.map(r => r.id));
        const people = reach.reduce((t, r) => ({
            individuals: t.individuals + num(r.individual_count),
            households: t.households + num(r.household_count),
            male: t.male + num(r.male_count),
            female: t.female + num(r.female_count),
            under18_male: t.under18_male + num(r.under18_male),
            under18_female: t.under18_female + num(r.under18_female),
            disabilities: t.disabilities + num(r.people_with_disabilities),
        }), { individuals: 0, households: 0, male: 0, female: 0, under18_male: 0, under18_female: 0, disabilities: 0 });

        // Arabic state names for the Arabic screen
        const { data: stateRows } = await db.from('states').select('state_name, state_name_ar');
        const state_labels_ar: Record<string, string> = {};
        (stateRows || []).forEach((r: any) => { if (r.state_name && r.state_name_ar) state_labels_ar[r.state_name] = r.state_name_ar; });

        return res.status(200).json({
            success: true,
            state_labels_ar,
            scope: scope.all ? 'all' : user.role === 'locality_err' ? 'locality' : (scope.states.length > 0 && user.role !== 'base_err' ? 'states' : 'room'),
            states: scope.all ? funding.map(f => f.state) : scope.states,
            locality: user.role === 'locality_err' ? { name: scope.ownLocality, name_ar: scope.ownLocalityAr } : null,
            locality_labels_ar,
            funding,
            projects: {
                total: projects.length,
                drafts,
                byStatus,
                byState: Object.entries(byState).map(([state, counts]) => ({
                    state, total: sumCounts(counts), counts,
                    localities: Object.entries(byLocality[state] || {}).map(([locality, lc]) => ({ locality, total: sumCounts(lc), counts: lc }))
                        .sort((a, b) => b.total - a.total),
                })).sort((a, b) => b.total - a.total),
            },
            budgets,
            people: { ...people, reports: reports.length, projects_reported: new Set(reports.map(r => r.project_id)).size },
            generated_at: new Date().toISOString(),
        });
    } catch (e: any) {
        console.error('dashboard:', e.message);
        return res.status(500).json({ success: false, message: 'Failed to build dashboard', error: e.message });
    }
}
