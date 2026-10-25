// Password link for an ACTIVE account, superadmin only.
// POST { user_id, method: 'email' } — Supabase emails the person a link to create their password
// POST { user_id, method: 'copy'  } — returns a one-time link for the admin to send (e.g. on WhatsApp)
// Either way the link opens /update-password. A new link replaces any older one for that person.
// The database checks the caller is a superadmin and the account is active, and logs every link.
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, sendRpcError, withJsonErrors, isUuid } from '../../services/f2Api';
import { getAdminClient, getEmailClient, siteOrigin } from '../../services/supabaseAdmin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;

    const { user_id, method } = req.body || {};
    if (!isUuid(user_id)) return res.status(400).json({ success: false, code: 'invalid_user_id' });
    if (method !== 'email' && method !== 'copy') return res.status(400).json({ success: false, code: 'invalid_method' });

    const { data: target, error: targetError } = await caller.client.rpc('um_link_target', { p_user_id: user_id });
    if (targetError) return sendRpcError(res, targetError);
    const email: string | undefined = target?.email;
    if (!email) return res.status(404).json({ success: false, code: 'user_not_found' });

    const origin = siteOrigin(req);
    if (!origin) return res.status(500).json({ success: false, code: 'server_error' });
    const redirectTo = `${origin}/update-password`;

    let link: string | undefined;
    if (method === 'email') {
        const client = getEmailClient();
        if (!client) return res.status(500).json({ success: false, code: 'server_error' });
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) {
            const status = (error as any)?.status;
            const msg = (error.message || '').toLowerCase();
            if (status === 429 || msg.includes('rate limit') || msg.includes('seconds')) {
                return res.status(429).json({ success: false, code: 'email_rate_limit' });
            }
            console.error('user-password-link email:', error.message);
            return res.status(502).json({ success: false, code: 'email_failed' });
        }
    } else {
        const admin = getAdminClient();
        if (!admin) return res.status(503).json({ success: false, code: 'service_key_missing' });
        const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
        const hashed = data?.properties?.hashed_token;
        if (error || !hashed) {
            const status = (error as any)?.status;
            if (status === 429) return res.status(429).json({ success: false, code: 'email_rate_limit' });
            console.error('user-password-link copy:', error?.message);
            return res.status(502).json({ success: false, code: 'link_failed' });
        }
        // Our own page verifies the token, so the link works on any phone or browser.
        link = `${redirectTo}?token_hash=${encodeURIComponent(hashed)}&type=recovery`;
    }

    const { data: sent, error: sentError } = await caller.client.rpc('um_link_sent', { p_user_id: user_id, p_method: method });
    if (sentError) console.error('user-password-link um_link_sent:', sentError.message);   // the link still went out
    return res.status(200).json({ success: true, method, link, sent: sent || null });
}

export default withJsonErrors(handler);
