// GET /api/files/url?path=<clean path>[&download=1]   (or ?id=<file id>)
// A link to one clean file that works for 5 minutes, for someone allowed to see its project.
// Both the register and the storage rules are checked as the caller, so the link is refused otherwise.
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAppUser } from '../../../services/requireAppUser';
import { createAuthenticatedClient } from '../../../services/createAuthenticatedClient';
import { CLEAN_BUCKET, isUuid } from '../../../services/secureFiles';

const LINK_SECONDS = 300;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const caller = await requireAppUser(req, res);
    if (!caller) return;
    const db = createAuthenticatedClient(caller.token);

    const id = String(req.query.id || '');
    const path = String(req.query.path || '');
    let query = db.from('file_uploads').select('clean_path, original_name, clean_mime, status, av_status');
    if (isUuid(id)) query = query.eq('id', id);
    else if (/^projects\/[0-9a-f-]{36}\/(f4|f5|scan)\/[0-9a-f-]{36}\.(jpg|pdf)$/i.test(path)) query = query.eq('clean_path', path);
    else return res.status(400).json({ success: false, code: 'invalid_file' });

    const { data: row } = await query.maybeSingle();
    if (!row || row.status !== 'clean' || row.av_status === 'infected') {
        return res.status(404).json({ success: false, code: 'file_not_found' });
    }
    const download = req.query.download === '1' ? (row.original_name || true) : undefined;
    const { data, error } = await db.storage.from(CLEAN_BUCKET)
        .createSignedUrl(row.clean_path, LINK_SECONDS, download ? { download } : undefined);
    if (error || !data?.signedUrl) return res.status(404).json({ success: false, code: 'file_not_found' });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, url: data.signedUrl, mime: row.clean_mime, expiresIn: LINK_SECONDS });
}
