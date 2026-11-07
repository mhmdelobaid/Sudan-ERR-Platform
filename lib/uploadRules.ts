/**
 * Upload rules (decided 7 Nov): photos (JPG, PNG, WebP) and PDF only. No Word or Excel.
 * The type is read from the file's first bytes, not from its name or what the browser says.
 */
export type AllowedUploadType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
export const UPLOAD_NOT_ALLOWED = 'Only photos (JPG, PNG, WebP) and PDF files can be uploaded.';

export function sniffUploadType(buf: Buffer | Uint8Array): AllowedUploadType | null {
  const b = buf;
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  // %PDF- within the first bytes
  const head = Buffer.from(b.slice(0, 1024)).toString('latin1');
  if (head.includes('%PDF-')) return 'application/pdf';
  return null;
}

export function extensionFor(type: AllowedUploadType): string {
  return type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
}
