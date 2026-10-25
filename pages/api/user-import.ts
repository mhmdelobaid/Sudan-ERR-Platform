// Account import, superadmin only.
// POST { action: 'check',  rows: [{ row, name, email, role, err_id }] }            — what's wrong with each row (no writes)
// POST { action: 'import', batch_id, rows: [{ row, name, email, role, err_id, position }] } (≤ 25 rows per call)
//      — creates a login for each good row (no password anyone knows) and a pending user. Nothing is emailed:
//        the person gets a password link only after an admin activates them (see /api/user-password-link).
// The database refuses anyone who isn't a superadmin, re-checks every row and logs each import in audit_logs.
import { randomBytes, randomUUID } from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors, isUuid } from '../../services/f2Api';
import { getAdminClient } from '../../services/supabaseAdmin';

const MAX_CHECK = 2000;
const MAX_IMPORT = 25;

type Row = { row: number; name: string; email: string; role: string; err_id: string | null; position?: string };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function cleanRows(raw: unknown, max: number): Row[] | null {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > max) return null;
    return raw.map((r: any, i) => ({
        row: Number.isInteger(r?.row) ? r.row : i + 1,
        name: str(r?.name, 200),
        email: str(r?.email, 320).toLowerCase(),
        role: str(r?.role, 40),
        err_id: isUuid(r?.err_id) ? r.err_id : null,
        position: str(r?.position, 200),
    }));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;
    const { action } = req.body || {};

    if (action === 'check') {
        const rows = cleanRows(req.body?.rows, MAX_CHECK);
        if (!rows) return res.status(400).json({ success: false, code: 'invalid_rows' });
        const { data, error } = await caller.client.rpc('um_import_check', {
            p_rows: rows.map(({ row, name, email, role, err_id }) => ({ row, name, email, role, err_id })),
        });
        if (error) return sendRpcError(res, error);
        return res.status(200).json({ success: true, results: data || [] });
    }

    if (action === 'import') {
        const rows = cleanRows(req.body?.rows, MAX_IMPORT);
        if (!rows) return res.status(400).json({ success: false, code: 'invalid_rows' });
        const batchId = isUuid(req.body?.batch_id) ? req.body.batch_id : randomUUID();

        // Superadmin check and a fresh look at every row before any login is created.
        const { data: checked, error: checkError } = await caller.client.rpc('um_import_check', {
            p_rows: rows.map(({ row, name, email, role, err_id }) => ({ row, name, email, role, err_id })),
        });
        if (checkError) return sendRpcError(res, checkError);

        const admin = getAdminClient();
        if (!admin) return res.status(503).json({ success: false, code: 'service_key_missing' });

        const results: { row: number; email: string; ok: boolean; user_id?: string; code?: string }[] = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const problems: string[] = (checked?.[i]?.problems as string[]) || [];
            if (problems.length > 0) { results.push({ row: r.row, email: r.email, ok: false, code: problems[0] }); continue; }

            // A long random password nobody sees; the person sets their own from the link after activation.
            const { data: created, error: createError } = await admin.auth.admin.createUser({
                email: r.email,
                email_confirm: true,
                password: randomBytes(24).toString('base64url') + 'aA1!',
                user_metadata: { display_name: r.name },
            });
            if (createError || !created?.user) {
                const msg = (createError?.message || '').toLowerCase();
                results.push({ row: r.row, email: r.email, ok: false,
                    code: msg.includes('already') || (createError as any)?.status === 422 ? 'email_exists' : 'login_create_failed' });
                if (createError) console.error('user-import createUser:', createError.message);
                continue;
            }

            const userId = created.user.id;
            const { error: importError } = await caller.client.rpc('um_import_user', {
                p_user_id: userId, p_email: r.email, p_name: r.name, p_role: r.role, p_err_id: r.err_id,
                p_position: r.position || null, p_batch: batchId,
            });
            if (importError) {
                // Don't leave a login without a user record behind.
                await admin.auth.admin.deleteUser(userId).catch(() => undefined);
                const known = ['email_exists', 'room_type_mismatch', 'room_required', 'room_not_found', 'invalid_role', 'name_required', 'only_superadmin']
                    .find(k => (importError.message || '').includes(k));
                if (!known) console.error('user-import um_import_user:', importError.message);
                results.push({ row: r.row, email: r.email, ok: false, code: known || 'server_error' });
                continue;
            }
            results.push({ row: r.row, email: r.email, ok: true, user_id: userId });
        }
        return res.status(200).json({ success: true, batch_id: batchId, results });
    }

    return res.status(400).json({ success: false, code: 'invalid_action' });
}

export default withJsonErrors(handler);
