// Server only. Checks an uploaded file and rebuilds it clean before anyone can open it.
//
//  - Only photos (JPEG, PNG, WebP) and PDF are accepted. The real type is read from the file's first bytes;
//    the name and the type the browser claims are ignored.
//  - Photos are decoded and re-drawn as a fresh JPEG. Anything hidden in the original (EXIF, GPS location,
//    comments, data appended after the image, a second file disguised inside it) does not survive.
//  - PDFs are rebuilt page by page into a new, empty PDF. The document-level parts that carry scripts and
//    actions (OpenAction, JavaScript, embedded files, forms, XFA) are never copied, and every page loses its
//    annotations and actions (links, form fields, attachments, media). The rebuilt file is then checked again
//    and refused if any of those parts is still there.
//  - Size, page, pixel and time limits stop files built to hang the server.
//
// No file is ever executed or opened by anything but these two decoders.
import { createHash } from 'crypto';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';

export const MAX_BYTES = 10 * 1024 * 1024;   // same as the storage buckets
export const MAX_PDF_PAGES = 60;
export const MAX_IMAGE_PIXELS = 40_000_000;  // ~ a 7,000 x 5,700 photo; phone cameras are well below
export const MAX_IMAGE_SIDE = 2600;          // clean photos are scaled down to this, enough to read a receipt
const TIME_LIMIT_MS = 20_000;

export type SniffedType = 'jpeg' | 'png' | 'webp' | 'pdf';

export type RejectCode =
    | 'empty'
    | 'too_large'
    | 'unsupported_type'
    | 'corrupt'
    | 'image_too_large'
    | 'encrypted_pdf'
    | 'too_many_pages'
    | 'active_content'
    | 'timeout';

export class FileRejected extends Error {
    constructor(public code: RejectCode, detail?: string) {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'FileRejected';
    }
}

export interface CleanFile {
    data: Buffer;
    mime: 'image/jpeg' | 'application/pdf';
    ext: 'jpg' | 'pdf';
    type: SniffedType;
    width?: number;
    height?: number;
    pages?: number;
    removed: string[];           // what the cleaner took out, for the register
    originalSha256: string;
    cleanSha256: string;
}

export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** The file's real type, from its first bytes. Nothing before the signature is allowed (no polyglots). */
export function sniffType(buf: Buffer): SniffedType | null {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
    if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
    return null;
}

/** A display-only name: no folders, no control or odd characters, at most 80 characters. */
export function safeDisplayName(name: unknown): string {
    const base = String(name ?? '').split(/[\\/]/).pop() || '';
    const cleaned = base
        .normalize('NFC')
        .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '') // control + bidi tricks
        .replace(/[^\p{L}\p{N} ._()\-]/gu, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return (cleaned || 'file').slice(0, 80);
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const t = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FileRejected('timeout')), TIME_LIMIT_MS);
    });
    return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

// ---- photos -------------------------------------------------------------------------------------------

/** EXIF holds a GPS block (tag 0x8825 in either byte order). Only used to report what was removed. */
function hasGpsTag(exif: Buffer): boolean {
    return exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88]));
}

/** Bytes after the JPEG end marker: a second file smuggled behind the photo. Only used for reporting. */
function hasDataAfterJpeg(buf: Buffer): boolean {
    const end = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
    return end !== -1 && buf.length - (end + 2) > 16;
}

async function cleanImage(buf: Buffer, type: SniffedType): Promise<Omit<CleanFile, 'originalSha256' | 'cleanSha256'>> {
    const removed: string[] = [];
    let meta: sharp.Metadata;
    try {
        meta = await sharp(buf, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' }).metadata();
    } catch (e: any) {
        if (/pixel limit/i.test(String(e?.message))) throw new FileRejected('image_too_large');
        throw new FileRejected('corrupt', e?.message);
    }
    if (!meta.width || !meta.height) throw new FileRejected('corrupt', 'no dimensions');
    if (meta.width * meta.height > MAX_IMAGE_PIXELS) throw new FileRejected('image_too_large');
    if ((meta.pages || 1) > 1) removed.push('extra_frames');
    if (meta.exif) removed.push('exif');
    if (meta.exif && hasGpsTag(meta.exif)) removed.push('gps');
    if (type === 'jpeg' && hasDataAfterJpeg(buf)) removed.push('hidden_data_after_image');
    if (meta.xmp) removed.push('xmp');
    if (meta.iptc) removed.push('iptc');
    if (meta.icc) removed.push('icc_profile');
    if (meta.comments?.length) removed.push('comments');

    try {
        const { data, info } = await sharp(buf, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error', pages: 1 })
            .rotate()                                  // apply the camera's rotation, then forget it
            .flatten({ background: '#ffffff' })        // transparent PNGs get a white page
            .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true })
            .toColourspace('srgb')
            .jpeg({ quality: 85, mozjpeg: true })      // no withMetadata(): nothing from the original is kept
            .toBuffer({ resolveWithObject: true });
        return { data, mime: 'image/jpeg', ext: 'jpg', type, width: info.width, height: info.height, removed };
    } catch (e: any) {
        throw new FileRejected('corrupt', e?.message);
    }
}

// ---- PDFs ---------------------------------------------------------------------------------------------

// Parts of a PDF that can run code, open other files or carry hidden content.
const ACTIVE_KEYS = [
    'JavaScript', 'JS', 'OpenAction', 'AA', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'FileAttachment',
    'RichMedia', 'XFA', 'AcroForm', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE', 'Sound', 'Movie', 'Rendition',
];
const ACTIVE_RE = new RegExp(`/(${ACTIVE_KEYS.join('|')})(?![A-Za-z0-9#])`, 'g');

/** Active-content keys in a PDF's structure. Stream bodies (page drawings, images, fonts) are skipped. */
export function findActiveContent(pdf: Buffer): string[] {
    const text = pdf.toString('latin1').replace(/stream\r?\n[\s\S]*?\r?\n?endstream/g, 'stream endstream');
    const found = new Set<string>();
    for (const m of text.matchAll(ACTIVE_RE)) found.add(m[1]);
    return Array.from(found);
}

async function cleanPdf(buf: Buffer): Promise<Omit<CleanFile, 'originalSha256' | 'cleanSha256'>> {
    const before = findActiveContent(buf);
    const removed = before.map(k => `pdf:${k}`);

    let data: Buffer;
    let count: number;
    try {
        let src: PDFDocument;
        try {
            src = await PDFDocument.load(buf, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true });
        } catch (e: any) {
            if (/encrypt/i.test(String(e?.message)) || e?.name === 'EncryptedPDFError') throw new FileRejected('encrypted_pdf');
            throw e;
        }
        if (src.isEncrypted) throw new FileRejected('encrypted_pdf');
        count = src.getPageCount();
        if (count === 0) throw new FileRejected('corrupt', 'no pages');
        if (count > MAX_PDF_PAGES) throw new FileRejected('too_many_pages', String(count));

        // Strip each page BEFORE copying it, so the stripped parts (and everything they point to, such as
        // an attached program) are never copied at all.
        const PAGE_KEYS_TO_DROP = ['Annots', 'AA', 'PieceInfo', 'Metadata', 'B', 'Thumb'];
        for (const page of src.getPages()) {
            for (const key of PAGE_KEYS_TO_DROP) {
                if (page.node.has(PDFName.of(key))) {
                    page.node.delete(PDFName.of(key));
                    if (key === 'Annots') removed.push('pdf:annotations');
                    if (key === 'AA') removed.push('pdf:page_actions');
                }
            }
        }

        // A brand-new document: only the pages are brought over, so nothing at document level comes with them.
        const out = await PDFDocument.create({ updateMetadata: false });
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const page of pages) out.addPage(page);
        // Fresh, plain document information; the original's title, author and software are not copied.
        out.setProducer('ERR file check');
        out.setCreator('ERR file check');

        // useObjectStreams:false keeps every dictionary readable so the check below sees all of it.
        data = Buffer.from(await out.save({ useObjectStreams: false, addDefaultPage: false }));
    } catch (e: any) {
        if (e instanceof FileRejected) throw e;
        throw new FileRejected('corrupt', e?.message);
    }

    const left = findActiveContent(data);
    if (left.length) throw new FileRejected('active_content', left.join(','));

    // Re-open the result to be sure it is a valid PDF.
    try {
        const check = await PDFDocument.load(data, { throwOnInvalidObject: true });
        if (check.getPageCount() !== count) throw new Error('page count changed');
        const cat = check.catalog as PDFDict;
        for (const k of ['OpenAction', 'AA', 'Names', 'AcroForm']) {
            if (cat.has(PDFName.of(k))) throw new FileRejected('active_content', k);
        }
    } catch (e: any) {
        if (e instanceof FileRejected) throw e;
        throw new FileRejected('corrupt', e?.message);
    }
    return { data, mime: 'application/pdf', ext: 'pdf', type: 'pdf', pages: count, removed: Array.from(new Set(removed)) };
}

// ---- entry point --------------------------------------------------------------------------------------

/**
 * Check a file and return a clean copy, or throw FileRejected.
 * @param imagesOnly  scanning a photo of a form: PDFs are refused
 */
export async function cleanUpload(buf: Buffer, opts: { imagesOnly?: boolean } = {}): Promise<CleanFile> {
    if (!buf || buf.length === 0) throw new FileRejected('empty');
    if (buf.length > MAX_BYTES) throw new FileRejected('too_large');
    const type = sniffType(buf);
    if (!type || (opts.imagesOnly && type === 'pdf')) throw new FileRejected('unsupported_type');

    const cleaned = await withTimeout(type === 'pdf' ? cleanPdf(buf) : cleanImage(buf, type));
    if (cleaned.data.length > MAX_BYTES) throw new FileRejected('too_large', 'after cleaning');
    return { ...cleaned, originalSha256: sha256(buf), cleanSha256: sha256(cleaned.data) };
}
