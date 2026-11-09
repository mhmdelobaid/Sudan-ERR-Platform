// Server only. The F1, F4 and F5 wizard routes receive the file on the server and store it themselves
// (bucket "images", which only the server can reach). Before storing, the file is rebuilt clean the same way
// /api/files/finalize does it: photos re-drawn as JPEG without EXIF or GPS, PDFs rebuilt without scripts,
// actions, attachments or forms. Anything else is refused with a code the screens translate (uploads:errors.*).
import { cleanUpload, FileRejected } from './fileSafety';

export type CleanedForStore = { data: Buffer; mime: string; ext: 'jpg' | 'pdf'; removed: string[] };

export async function cleanBeforeStore(
    buf: Buffer
): Promise<{ ok: boolean; file?: CleanedForStore; status?: number; code?: string }> {
    try {
        const c = await cleanUpload(buf);
        return { ok: true, file: { data: c.data, mime: c.mime, ext: c.ext, removed: c.removed } };
    } catch (e) {
        if (e instanceof FileRejected) {
            return { ok: false, status: e.code === 'unsupported_type' ? 415 : e.code === 'too_large' ? 413 : 422, code: e.code };
        }
        throw e;
    }
}

/** The same storage key with the clean file's extension (a PNG or WebP photo becomes .jpg). */
export function withCleanExt(key: string, ext: string): string {
    return key.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.' + ext;
}
