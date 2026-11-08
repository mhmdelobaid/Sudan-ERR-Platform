// Browser side of the secure upload: the file goes to the private quarantine first (resumable, so a weak
// connection can pick up where it stopped), then the server checks it, rebuilds it clean and stores it.
// Only the clean copy's path is ever saved in a report.
import * as tus from 'tus-js-client';
import { v4 as uuidv4 } from 'uuid';
import { newSupabase } from './newSupabaseClient';

export type UploadKind = 'f4' | 'f5' | 'scan';

/** What the file pickers offer. The server checks the real content anyway. */
export const ACCEPT_FILES = 'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf';
export const ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Error codes have a message under uploads:errors.<code> in the locale files. */
export class SecureUploadError extends Error {
    constructor(public code: string) { super(code); this.name = 'SecureUploadError'; }
}

export interface SecureFile {
    id: string;
    path: string;      // store this in the report (receipts.image_url, err_program_files.file_url)
    name: string;
    mime: string;
    size: number;
    removed: string[];
}

/** Quick check before sending, so people hear at once about a wrong or too-large file. */
export function precheckFile(file: File, opts: { imagesOnly?: boolean } = {}): string | null {
    if (!file || file.size === 0) return 'empty';
    if (file.size > MAX_UPLOAD_BYTES) return 'too_large';
    const type = (file.type || '').toLowerCase();
    const byName = /\.(jpe?g|png|webp|pdf)$/i.test(file.name || '');
    if (type ? !ALLOWED_MIME.includes(type) : !byName) return 'unsupported_type';
    if (opts.imagesOnly && (type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))) return 'unsupported_type';
    return null;
}

function contentTypeFor(file: File): string {
    const type = (file.type || '').toLowerCase();
    if (ALLOWED_MIME.includes(type)) return type;
    if (/\.pdf$/i.test(file.name)) return 'application/pdf';
    if (/\.png$/i.test(file.name)) return 'image/png';
    if (/\.webp$/i.test(file.name)) return 'image/webp';
    return 'image/jpeg';
}

function sendToQuarantine(file: File, objectName: string, token: string, onProgress?: (pct: number) => void) {
    const base = (process.env.NEXT_PUBLIC_NEW_SUPABASE_URL || '').replace(/\/$/, '');
    const anon = process.env.NEXT_PUBLIC_NEW_SUPABASE_ANON_KEY || '';
    return new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
            endpoint: `${base}/storage/v1/upload/resumable`,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            headers: { authorization: `Bearer ${token}`, apikey: anon, 'x-upsert': 'false' },
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            metadata: {
                bucketName: 'uploads-incoming',
                objectName,
                contentType: contentTypeFor(file),
                cacheControl: '0',
            },
            chunkSize: 6 * 1024 * 1024,
            onError: (err: any) => {
                const status = err?.originalResponse?.getStatus?.();
                reject(new SecureUploadError(status === 413 ? 'too_large' : status === 415 || status === 400 ? 'unsupported_type'
                    : status === 401 || status === 403 ? 'not_allowed' : 'network'));
            },
            onProgress: (sent, total) => onProgress?.(Math.min(90, Math.round((sent / total) * 90))),
            onSuccess: () => resolve(),
        });
        upload.findPreviousUploads().then((previous) => {
            if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
            upload.start();
        });
    });
}

/**
 * Upload one file safely. Resolves with the clean file, or rejects with SecureUploadError(code).
 * Progress runs to 90% while sending, then 100% once the server has checked and stored the file.
 */
export async function secureUpload(file: File, opts: {
    projectId: string;
    kind: UploadKind;
    imagesOnly?: boolean;
    onProgress?: (pct: number) => void;
}): Promise<SecureFile> {
    const problem = precheckFile(file, { imagesOnly: opts.imagesOnly });
    if (problem) throw new SecureUploadError(problem);

    const { data: { session } } = await newSupabase.auth.getSession();
    if (!session?.access_token || !session.user?.id) throw new SecureUploadError('not_signed_in');

    const objectName = `${session.user.id}/${uuidv4()}`;
    await sendToQuarantine(file, objectName, session.access_token, opts.onProgress);

    let res: Response;
    try {
        res = await fetch('/api/files/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ path: objectName, projectId: opts.projectId, kind: opts.kind, name: file.name }),
        });
    } catch {
        throw new SecureUploadError('network');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.success) throw new SecureUploadError(body?.code || 'server_error');
    opts.onProgress?.(100);
    return body.file as SecureFile;
}

/** A 5-minute link to a clean file, for opening it in the browser. */
export async function cleanFileLink(path: string, download = false): Promise<string> {
    const { data: { session } } = await newSupabase.auth.getSession();
    if (!session?.access_token) throw new SecureUploadError('not_signed_in');
    const res = await fetch(`/api/files/url?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.url) throw new SecureUploadError(body?.code || 'file_not_found');
    return body.url;
}
