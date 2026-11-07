// services/offlineSync.ts
// Sends F4 reports saved in offline mode (services/offlineReports.ts) to the launch database, as the person who is
// signed in on this phone, through the same tables and access rules as the online F4 form:
//   err_summary (one row) -> err_expense (one per expense, linked by summary_id) -> receipts (photo links).
// Rows are written as drafts first and switched to "sent" only once everything is in, so a report that fails
// halfway leaves nothing behind. err_summary.original_text.offline_id holds the report's id on the phone: if the
// phone lost the answer last time, the next try finds the report and doesn't send it twice.
// Runs when the phone comes back online (pages/_app.tsx), when the app opens, on the menu after sign-in, and from
// the "Send now" button in offline mode. Nothing here writes to the old MAG database.
import { newSupabase } from './newSupabaseClient';
import { uploadImages } from './uploadImages';
import {
    getReports, updateReport, markSent, getPhoto, toNumber, reportTotal,
    OfflineReport, FailReason,
} from './offlineReports';

export interface SyncResult { sent: number; failed: number; waiting: number; needSignIn: boolean; offline: boolean }

const LOCK_KEY = 'offlineSyncLock';
const LOCK_MS = 2 * 60 * 1000;
let running: Promise<SyncResult> | null = null;

/** Sends every report that is waiting (or failed earlier). Safe to call often: one run at a time. */
export function sendQueuedReports(): Promise<SyncResult> {
    if (!running) running = run().finally(() => { running = null; });
    return running;
}

function takeLock(): boolean {
    try {
        const held = Number(localStorage.getItem(LOCK_KEY) || 0);
        if (Date.now() - held < LOCK_MS) return false; // another tab is sending
        localStorage.setItem(LOCK_KEY, String(Date.now()));
        return true;
    } catch {
        return true;
    }
}

function releaseLock() {
    try { localStorage.removeItem(LOCK_KEY); } catch { /* ignore */ }
}

async function run(): Promise<SyncResult> {
    const result: SyncResult = { sent: 0, failed: 0, waiting: 0, needSignIn: false, offline: false };
    if (typeof window === 'undefined') return result;

    const todo = getReports().filter(r => r.status !== 'sent');
    const ready = todo.filter(r => r.project_id);
    result.waiting = todo.length;
    if (ready.length === 0) return result;
    if (!navigator.onLine) { result.offline = true; return result; }

    const { data: { session } } = await newSupabase.auth.getSession();
    if (!session) { result.needSignIn = true; return result; }
    if (!takeLock()) return result;

    try {
        for (const r of ready) {
            updateReport(r.id, { status: 'sending', reason: undefined });
            try {
                await sendOne(r);
                await markSent(r.id);
                result.sent++;
            } catch (e) {
                const reason = classify(e);
                updateReport(r.id, { status: 'failed', reason, tries: (r.tries || 0) + 1 });
                result.failed++;
                if (reason === 'network') break; // the connection dropped: try the rest next time
            }
        }
    } finally {
        releaseLock();
    }
    result.waiting = getReports().filter(r => r.status !== 'sent').length;
    return result;
}

function classify(e: any): FailReason {
    const msg = String(e?.message || e || '');
    if (e?.code === 'photo_upload') return 'photo_upload';
    if (e?.code === '42501' || /row-level security|permission denied|not_allowed|protected/i.test(msg)) return 'no_access';
    if (e?.name === 'TypeError' || /failed to fetch|network|load failed/i.test(msg)) return 'network';
    return 'unknown';
}

const blank = (v?: string) => (v && v.trim() ? v.trim() : null);

async function sendOne(r: OfflineReport): Promise<void> {
    const db = newSupabase;

    // 1. Sent already? (the phone may not have heard the answer last time)
    const { data: existing, error: findError } = await db
        .from('err_summary')
        .select('id, is_draft')
        .eq('project_id', r.project_id)
        .contains('original_text', { offline_id: r.id })
        .limit(1);
    if (findError) throw findError;
    if (existing && existing.length > 0) {
        if (!existing[0].is_draft) return;
        await removeDraft(existing[0].id); // a half-sent try: start again
    }

    // 2. Receipt photos first: if one can't be uploaded, nothing is written and the report stays on the phone.
    const expenses = r.expenses.filter(e => blank(e.amount) || blank(e.description) || blank(e.activity));
    const photoUrls: (string | null)[] = expenses.map(() => null);
    const files: File[] = [];
    const fileFor: number[] = [];
    for (let i = 0; i < expenses.length; i++) {
        const id = expenses[i].photo_id;
        if (!id) continue;
        const file = await getPhoto(id);
        if (file) { files.push(file); fileFor.push(i); }
    }
    if (files.length > 0) {
        const uploaded = await uploadImages(files, r.project_id, 'financial');
        uploaded.forEach((u, k) => {
            if (!u?.success || !u.url) throw Object.assign(new Error('photo_upload'), { code: 'photo_upload' });
            photoUrls[fileFor[k]] = u.url;
        });
    }

    // 3. The report, as a draft until everything is in
    const total = reportTotal({ expenses });
    const grant = toNumber(r.total_grant);
    const other = toNumber(r.total_other_sources);
    const lang = (typeof document !== 'undefined' && document.documentElement.lang) || 'ar';
    const { data: summary, error: summaryError } = await db
        .from('err_summary')
        .insert([{
            err_id: r.err_id || null,
            project_id: r.project_id,
            report_date: r.report_date || null,
            total_expenses: total,
            total_grant: grant,
            total_other_sources: other,
            remainder: grant === null ? null : grant + (other || 0) - total,
            excess_expenses: blank(r.excess_expenses),
            surplus_use: blank(r.surplus_use),
            training: blank(r.training),
            lessons: blank(r.lessons),
            language: lang.startsWith('en') ? 'en' : 'ar',
            project_objectives: r.project_name || null,
            is_draft: true,
            original_text: { offline_id: r.id, source: 'offline_mode', saved_at: r.saved_at },
        }])
        .select('id')
        .single();
    if (summaryError) throw summaryError;

    try {
        // 4. Expenses, each with its receipt photo
        for (let i = 0; i < expenses.length; i++) {
            const e = expenses[i];
            const { data: row, error: expenseError } = await db
                .from('err_expense')
                .insert([{
                    project_id: r.project_id,
                    summary_id: summary.id,
                    expense_activity: blank(e.activity),
                    expense_description: blank(e.description),
                    expense_amount: toNumber(e.amount),
                    payment_date: e.payment_date || null,
                    payment_method: e.payment_method || null,
                    receipt_no: blank(e.receipt_no),
                    seller: blank(e.seller),
                    language: lang.startsWith('en') ? 'en' : 'ar',
                    is_draft: true,
                }])
                .select('expense_id')
                .single();
            if (expenseError) throw expenseError;
            if (photoUrls[i]) {
                const { error: receiptError } = await db
                    .from('receipts')
                    .insert([{ expense_id: row.expense_id, image_url: photoUrls[i] }]);
                if (receiptError) throw receiptError;
            }
        }

        // 5. Everything is in: the report is sent
        const { error: e1 } = await db.from('err_expense').update({ is_draft: false }).eq('summary_id', summary.id);
        if (e1) throw e1;
        const { error: e2 } = await db.from('err_summary').update({ is_draft: false }).eq('id', summary.id);
        if (e2) throw e2;
    } catch (e) {
        await removeDraft(summary.id).catch(() => { /* the next try finds and removes it */ });
        throw e;
    }
}

/** Removes a draft report written by an earlier, unfinished try (its receipts and expenses first). */
async function removeDraft(summaryId: number) {
    const db = newSupabase;
    const { data: rows } = await db.from('err_expense').select('expense_id').eq('summary_id', summaryId);
    const ids = (rows || []).map((x: any) => x.expense_id);
    if (ids.length) await db.from('receipts').delete().in('expense_id', ids);
    await db.from('err_expense').delete().eq('summary_id', summaryId);
    await db.from('err_summary').delete().eq('id', summaryId).eq('is_draft', true);
}
