// POST /api/files/finalize  { path, projectId, kind: 'f4' | 'f5' | 'scan', name }
// Checks a file the caller has just put in quarantine (uploads-incoming/<their id>/<uuid>), rebuilds it clean
// and stores it. Answers { success, file: { id, path, name, mime, size, removed } } or { success:false, code }.
// Codes a person may see: unsupported_type, too_large, corrupt, image_too_large, encrypted_pdf,
// too_many_pages, active_content, timeout, too_many_uploads, not_allowed.
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAppUser } from '../../../services/requireAppUser';
import { createAuthenticatedClient } from '../../../services/createAuthenticatedClient';
import { getAdminClient } from '../../../services/supabaseAdmin';
import { finalizeUpload, UploadError, UploadKind } from '../../../services/secureFiles';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await requireAppUser(req, res);
    if (!caller) return;

    const admin = getAdminClient();
    if (!admin) return res.status(503).json({ success: false, code: 'not_configured' });

    const { path, projectId, kind, name } = req.body || {};
    try {
        const file = await finalizeUpload({
            admin,
            userClient: createAuthenticatedClient(caller.token),
            userId: caller.user.id,
            incomingPath: String(path || ''),
            projectId: String(projectId || ''),
            kind: String(kind || '') as UploadKind,
            originalName: typeof name === 'string' ? name : undefined,
        });
        return res.status(200).json({ success: true, file });
    } catch (e: any) {
        if (e instanceof UploadError) return res.status(e.status).json({ success: false, code: e.code });
        console.error('files/finalize:', e?.message);
        return res.status(500).json({ success: false, code: 'server_error' });
    }
}
