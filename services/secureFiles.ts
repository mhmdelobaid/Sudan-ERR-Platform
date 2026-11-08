// Server only. Moves an upload from quarantine to the clean store, and reads clean files back.
// Never import this into a page or component: it uses the service role key.
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanUpload, FileRejected, safeDisplayName, sniffType } from './fileSafety';

export const INCOMING_BUCKET = 'uploads-incoming';
export const CLEAN_BUCKET = 'uploads-clean';
export const UPLOAD_KINDS = ['f4', 'f5', 'scan'] as const;
export type UploadKind = typeof UPLOAD_KINDS[number];
export const UPLOADS_PER_HOUR = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export class UploadError extends Error {
    constructor(public status: number, public code: string) { super(code); }
}

export interface FinalizedFile {
    id: string;
    path: string;          // path inside the clean bucket; this is what reports store
    name: string;          // display name only
    mime: string;
    size: number;
    removed: string[];
}

const mimeOf = (t: ReturnType<typeof sniffType>) =>
    t === 'pdf' ? 'application/pdf' : t ? `image/${t}` : null;

/**
 * Check one quarantined upload and, if it passes, store its clean copy and register it.
 * The quarantined original is always deleted, pass or fail.
 */
export async function finalizeUpload(opts: {
    admin: SupabaseClient;        // service role
    userClient: SupabaseClient;   // runs as the caller (access rules apply)
    userId: string;
    incomingPath: string;
    projectId: string;
    kind: UploadKind;
    originalName?: string;
}): Promise<FinalizedFile> {
    const { admin, userClient, userId, incomingPath, projectId, kind } = opts;

    // The caller may only finalize their own quarantined file, named <their id>/<uuid>.
    const [owner, objectId, ...rest] = String(incomingPath || '').split('/');
    if (owner !== userId || !isUuid(objectId) || rest.length) throw new UploadError(400, 'invalid_path');
    if (!isUuid(projectId)) throw new UploadError(400, 'invalid_project');
    if (!UPLOAD_KINDS.includes(kind)) throw new UploadError(400, 'invalid_kind');
    const name = safeDisplayName(opts.originalName);

    try {
        // Only people who may write to this project may attach files to it.
        const { data: canWrite, error: accessError } = await userClient
            .rpc('local_can_access_project', { pid: projectId, for_write: true });
        if (accessError || canWrite !== true) throw new UploadError(403, 'not_allowed');

        // A simple brake against flooding (counts clean and refused uploads alike).
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count } = await admin.from('file_uploads')
            .select('id', { count: 'exact', head: true })
            .eq('uploaded_by', userId).gte('created_at', since);
        if ((count ?? 0) >= UPLOADS_PER_HOUR) throw new UploadError(429, 'too_many_uploads');

        const { data: blob, error: dlError } = await admin.storage.from(INCOMING_BUCKET).download(incomingPath);
        if (dlError || !blob) throw new UploadError(404, 'upload_not_found');
        const original = Buffer.from(await blob.arrayBuffer());

        let clean;
        try {
            clean = await cleanUpload(original);
        } catch (e) {
            if (!(e instanceof FileRejected)) throw e;
            // Keep a record of the refusal (no file is kept).
            await admin.from('file_uploads').insert({
                project_id: projectId, uploaded_by: userId, kind, status: 'rejected', reject_code: e.code,
                original_name: name, original_mime: mimeOf(sniffType(original)), original_size: original.length,
            });
            throw new UploadError(422, e.code);
        }

        const cleanPath = `projects/${projectId}/${kind}/${randomUUID()}.${clean.ext}`;
        const { error: upError } = await admin.storage.from(CLEAN_BUCKET).upload(cleanPath, clean.data, {
            contentType: clean.mime, upsert: false, cacheControl: '300',
        });
        if (upError) throw new UploadError(500, 'store_failed');

        const { data: row, error: insError } = await admin.from('file_uploads').insert({
            project_id: projectId, uploaded_by: userId, kind, status: 'clean',
            original_name: name, original_mime: mimeOf(clean.type), original_size: original.length,
            original_sha256: clean.originalSha256,
            clean_path: cleanPath, clean_mime: clean.mime, clean_size: clean.data.length, clean_sha256: clean.cleanSha256,
            pages: clean.pages ?? null, width: clean.width ?? null, height: clean.height ?? null, removed: clean.removed,
        }).select('id').single();
        if (insError || !row) {
            await admin.storage.from(CLEAN_BUCKET).remove([cleanPath]);
            throw new UploadError(500, 'register_failed');
        }

        return { id: row.id, path: cleanPath, name, mime: clean.mime, size: clean.data.length, removed: clean.removed };
    } finally {
        // Nothing stays in quarantine.
        await admin.storage.from(INCOMING_BUCKET).remove([incomingPath]).catch(() => undefined);
    }
}

/**
 * Read a clean file the caller is allowed to see (checked as the caller), for server-side processing.
 */
export async function readCleanFile(opts: {
    admin: SupabaseClient;
    userClient: SupabaseClient;
    fileId: string;
    kind?: UploadKind;
}): Promise<{ data: Buffer; mime: string; path: string }> {
    if (!isUuid(opts.fileId)) throw new UploadError(400, 'invalid_file');
    const { data: row } = await opts.userClient.from('file_uploads')
        .select('clean_path, clean_mime, kind, status, av_status')
        .eq('id', opts.fileId).maybeSingle();
    if (!row || row.status !== 'clean' || row.av_status === 'infected' || (opts.kind && row.kind !== opts.kind)) {
        throw new UploadError(404, 'file_not_found');
    }
    const { data: blob, error } = await opts.admin.storage.from(CLEAN_BUCKET).download(row.clean_path);
    if (error || !blob) throw new UploadError(404, 'file_not_found');
    return { data: Buffer.from(await blob.arrayBuffer()), mime: row.clean_mime, path: row.clean_path };
}
