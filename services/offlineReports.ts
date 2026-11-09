// services/offlineReports.ts
// F4 reports filled in offline mode, kept on the phone until they can be sent (services/offlineSync.ts).
//
// - The report list (without photos) lives in localStorage under REPORTS_KEY.
// - Receipt photos live in IndexedDB (they're too big for localStorage, and a browser "object URL" dies when the
//   page closes). Each photo is shrunk first (longest side 1600 px, JPEG) so it sends faster on a weak connection.
// - The projects a person can report on, and the expense types, are saved while they're online and signed in
//   (pages/menu.tsx calls cacheForOffline), so the offline form can offer them with no network.
// - Reports saved by the old offline form (key 'offlineSessionQueue': a typed ERR code, no project) are moved
//   into the new list once, marked "choose the project", so nothing a room saved earlier is lost.
// Sign-out (services/appLock.ts) leaves all of this on the phone: a report saved offline is never lost.
// Sealed (decision 10 Nov 2026, services/offlineCrypto.ts): once the phone has the server's public key, every report
// and receipt photo is kept encrypted. Only what the list screen needs stays readable: the report's id, status,
// dates, number of expenses, and the project/room ids (no names, amounts or text). The phone itself can't open a
// sealed report: the signed-in owner gets its key from the server when sending.

import { canSeal, sealOwner, sealText, sealBytes, openText, openBytes, SealedText, SealedBytes } from './offlineCrypto';

export const REPORTS_KEY = 'offlineReportsV2';
export const PROJECTS_KEY = 'offlineProjects';
export const CATEGORIES_KEY = 'offlineCategories';
const LEGACY_QUEUE_KEYS = ['offlineSessionQueue', 'offlineQueue'];
export const CHANGED_EVENT = 'offlineReportsChanged';

const DB_NAME = 'err-offline';
const PHOTO_STORE = 'photos';
const SENT_KEEP_DAYS = 14;
const PHOTO_NAME = 'receipt.jpg'; // sealed photos keep no file name

export type ReportStatus = 'waiting' | 'sending' | 'failed' | 'sent';
export type FailReason = 'no_access' | 'photo_upload' | 'network' | 'not_signed_in' | 'no_project' | 'unknown';

export interface OfflineExpense {
    activity: string;
    description: string;
    payment_date: string;
    seller: string;
    payment_method: string;   // 'cash' | 'bank_transfer' (same values as the online F4)
    receipt_no: string;
    amount: string;
    photo_id?: string;        // IndexedDB key of the receipt photo
    photo_name?: string;
}

export interface OfflineReport {
    id: string;               // also written to err_summary.original_text.offline_id, so a report is never sent twice
    version: 2;
    saved_at: string;
    project_id: string;       // '' for a report from the old form that still needs a project
    project_name: string;
    err_id: string;           // the project's room
    report_date: string;
    total_grant: string;
    total_other_sources: string;
    excess_expenses: string;
    surplus_use: string;
    training: string;
    lessons: string;
    expenses: OfflineExpense[];
    status: ReportStatus;
    reason?: FailReason;
    tries: number;
    sent_at?: string;
    legacy_err_code?: string; // what was typed in the old form's ERR field
    // Sealed reports: everything above except id, status, dates and ids is inside `sealed`
    sealed?: SealedText;
    n_expenses?: number;
    photo_ids?: string[];
    owner?: string;
}

export interface CachedProject {
    id: string;
    name: string;
    err_id: string;
    room_name?: string;
    room_name_ar?: string;
}

// ---------- small helpers ----------

const hasWindow = () => typeof window !== 'undefined';

function readJson<T>(key: string, fallback: T): T {
    if (!hasWindow()) return fallback;
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key: string, value: unknown) {
    if (!hasWindow()) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full: the caller still has the data */ }
}

export function newId(): string {
    try { return crypto.randomUUID(); } catch { /* older browsers */ }
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function notifyChanged() {
    if (!hasWindow()) return;
    try { window.dispatchEvent(new CustomEvent(CHANGED_EVENT)); } catch { /* ignore */ }
}

export const toNumber = (v: string | number | null | undefined): number | null => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
};

export const reportTotal = (r: Pick<OfflineReport, 'expenses'>) =>
    r.expenses.reduce((sum, e) => sum + (toNumber(e.amount) || 0), 0);

// ---------- reports ----------

export function getReports(): OfflineReport[] {
    migrateLegacyQueue();
    const list = readJson<OfflineReport[]>(REPORTS_KEY, []);
    // Sent reports are kept for a short while only, as a receipt on the screen.
    const cutoff = Date.now() - SENT_KEEP_DAYS * 24 * 3600 * 1000;
    const kept = list.filter(r => r.status !== 'sent' || !r.sent_at || Date.parse(r.sent_at) > cutoff);
    if (kept.length !== list.length) writeJson(REPORTS_KEY, kept);
    return kept;
}

function saveReports(list: OfflineReport[]) {
    writeJson(REPORTS_KEY, list);
    notifyChanged();
}

/** Saves a new report on the phone, sealed when the phone can seal (otherwise sealed later, see sealWaitingReports). */
export async function addReport(report: OfflineReport) {
    let stored = report;
    try { if (canSeal()) stored = await sealReport(report); } catch { /* keep it readable rather than lose it */ }
    const list = getReports();
    list.push(stored);
    saveReports(list);
}

const photoIdsOf = (r: OfflineReport) =>
    r.photo_ids || r.expenses.map(e => e.photo_id).filter((x): x is string => !!x);

/** Seal one readable report: only ids, status and dates stay readable. */
async function sealReport(r: OfflineReport): Promise<OfflineReport> {
    if (r.sealed) return r;
    const { id, version, saved_at, status, reason, tries, sent_at, project_id, err_id } = r;
    const content = { ...r };
    return {
        id, version, saved_at, status, reason, tries, sent_at, project_id, err_id,
        project_name: '', report_date: '', total_grant: '', total_other_sources: '',
        excess_expenses: '', surplus_use: '', training: '', lessons: '', expenses: [],
        n_expenses: r.expenses.length,
        photo_ids: photoIdsOf(r),
        owner: sealOwner() || undefined,
        sealed: await sealText(content),
    };
}

/**
 * Seal every report and photo still kept readable (saved before the phone had the key, or from the old form).
 * Safe to call often; does nothing until the phone has the server's public key.
 */
export async function sealWaitingReports(): Promise<void> {
    if (!canSeal()) return;
    const list = getReports();
    let changed = false;
    for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r.sealed || r.status === 'sent') continue;
        try {
            for (const pid of photoIdsOf(r)) await sealStoredPhoto(pid);
            list[i] = await sealReport(r);
            changed = true;
        } catch { /* try again next time */ }
    }
    if (changed) {
        // Merge with what's on the phone now (another screen may have changed a status meanwhile)
        const byId = new Map(list.map(r => [r.id, r]));
        saveReports(getReports().map(r => (byId.get(r.id)?.sealed && !r.sealed ? { ...byId.get(r.id)!, status: r.status, reason: r.reason, tries: r.tries, project_id: r.project_id, err_id: r.err_id } : r)));
    }
}

/** The full report, for sending. Sealed reports are opened through the server (signed-in owner only). */
export async function openReport(r: OfflineReport): Promise<OfflineReport> {
    if (!r.sealed) return r;
    const content = await openText<OfflineReport>(r.sealed);
    // Readable fields changed since sealing (status, the project chosen later) win over the sealed copy
    return { ...content, id: r.id, status: r.status, reason: r.reason, tries: r.tries,
        project_id: r.project_id || content.project_id, err_id: r.err_id || content.err_id, sealed: undefined };
}

export function updateReport(id: string, patch: Partial<OfflineReport>) {
    const list = getReports().map(r => (r.id === id ? { ...r, ...patch } : r));
    saveReports(list);
}

/** After a report is sent: keep only what the screen shows, and drop its photos from the phone. */
export async function markSent(id: string) {
    const r = getReports().find(x => x.id === id);
    if (!r) return;
    await Promise.all(photoIdsOf(r).map(deletePhoto));
    updateReport(id, {
        status: 'sent', reason: undefined, sent_at: new Date().toISOString(),
        excess_expenses: '', surplus_use: '', training: '', lessons: '', sealed: undefined, photo_ids: [],
        n_expenses: r.n_expenses ?? r.expenses.length,
        expenses: r.expenses.map(e => ({ ...e, description: '', seller: '', receipt_no: '', photo_id: undefined })),
    });
}

export async function deleteReport(id: string) {
    const r = getReports().find(x => x.id === id);
    if (r) await Promise.all(photoIdsOf(r).map(deletePhoto));
    saveReports(getReports().filter(x => x.id !== id));
}

export const unsentReports = () => getReports().filter(r => r.status !== 'sent');

/** Reports from the old offline form (typed ERR code, no project): moved into the new list, once. */
function migrateLegacyQueue() {
    if (!hasWindow()) return;
    let legacy: any[] = [];
    for (const key of LEGACY_QUEUE_KEYS) {
        const items = readJson<any[]>(key, []);
        if (Array.isArray(items) && items.length) legacy = legacy.concat(items);
    }
    if (legacy.length === 0) return;
    const list = readJson<OfflineReport[]>(REPORTS_KEY, []);
    const seen = new Set<string>();
    for (const old of legacy) {
        const f = old?.formData || {};
        const sig = JSON.stringify([f.err_id, f.date, f.total_grant, (old?.expenses || []).length]);
        if (seen.has(sig)) continue; // the old code sometimes kept the same form in both keys
        seen.add(sig);
        list.push({
            id: newId(), version: 2, saved_at: new Date().toISOString(),
            project_id: '', project_name: '', err_id: '',
            report_date: f.date || '', total_grant: String(f.total_grant ?? ''), total_other_sources: String(f.total_other_sources ?? ''),
            excess_expenses: f.additional_excess_expenses || '', surplus_use: f.additional_surplus_use || '',
            training: f.additional_training_needs || '', lessons: f.lessons || '',
            expenses: (old?.expenses || []).map((e: any) => ({
                activity: e.activity || '', description: e.description || '', payment_date: e.payment_date || '',
                seller: e.seller || '', payment_method: e.payment_method === 'bank app' ? 'bank_transfer' : (e.payment_method || 'cash'),
                receipt_no: e.receipt_no || '', amount: String(e.amount ?? ''),
            })),
            status: 'waiting', reason: 'no_project', tries: 0, legacy_err_code: f.err_id || '',
        });
    }
    writeJson(REPORTS_KEY, list);
    LEGACY_QUEUE_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
}

// ---------- projects and expense types saved for offline use ----------

export function cacheForOffline(userId: string, projects: any[], categories?: string[]) {
    const list: CachedProject[] = (projects || [])
        .filter(p => p && p.id)
        .map(p => ({
            id: String(p.id),
            name: String(p.project_objectives || p.project_name || '').trim() || String(p.id).slice(0, 8),
            err_id: String(p.err_id || ''),
            room_name: p.room?.name || undefined,
            room_name_ar: p.room?.name_ar || undefined,
        }));
    writeJson(PROJECTS_KEY, { user_id: userId, saved_at: new Date().toISOString(), projects: list });
    if (categories && categories.length) writeJson(CATEGORIES_KEY, categories);
}

export function getCachedProjects(): { projects: CachedProject[]; saved_at?: string } {
    const v = readJson<{ projects?: CachedProject[]; saved_at?: string }>(PROJECTS_KEY, {});
    return { projects: Array.isArray(v.projects) ? v.projects : [], saved_at: v.saved_at };
}

export const getCachedCategories = (): string[] => {
    const v = readJson<string[]>(CATEGORIES_KEY, []);
    return Array.isArray(v) ? v : [];
};

// ---------- receipt photos (IndexedDB) ----------

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (!hasWindow() || !('indexedDB' in window)) { reject(new Error('no_indexeddb')); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(PHOTO_STORE)) req.result.createObjectStore(PHOTO_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(PHOTO_STORE, mode);
            const req = run(tx.objectStore(PHOTO_STORE));
            tx.oncomplete = () => resolve(req.result as T);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

// A photo is kept either readable ({ blob, name, type }) or sealed ({ sealed, type }).
interface StoredPhoto { blob?: Blob; name?: string; type: string; sealed?: SealedBytes }

/** Shrinks a photo (longest side 1600 px, JPEG 0.8). Anything that isn't a photo, or can't be read, is kept as it is. */
export async function shrinkPhoto(file: File): Promise<{ blob: Blob; name: string; type: string }> {
    const original = { blob: file as Blob, name: file.name || 'receipt.jpg', type: file.type || 'application/octet-stream' };
    if (!file.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return original;
    try {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * scale));
        const h = Math.max(1, Math.round(bmp.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return original;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bmp, 0, 0, w, h);
        bmp.close?.();
        const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
        if (!blob || blob.size >= file.size) return original;
        const base = (file.name || 'receipt').replace(/\.[^.]+$/, '');
        return { blob, name: `${base}.jpg`, type: 'image/jpeg' };
    } catch {
        return original;
    }
}

export async function savePhoto(file: File): Promise<{ id: string; name: string }> {
    const small = await shrinkPhoto(file);
    const id = newId();
    let value: StoredPhoto = { blob: small.blob, name: small.name, type: small.type };
    try {
        if (canSeal()) value = { type: small.type, sealed: await sealBytes(await small.blob.arrayBuffer()) };
    } catch { /* keep it readable; sealed later */ }
    await withStore<IDBValidKey>('readwrite', s => s.put(value, id));
    return { id, name: value.sealed ? PHOTO_NAME : small.name };
}

/** Seal a photo that was kept readable. */
async function sealStoredPhoto(id: string): Promise<void> {
    const v = await withStore<StoredPhoto | undefined>('readonly', s => s.get(id));
    if (!v || v.sealed || !v.blob) return;
    const sealed = await sealBytes(await v.blob.arrayBuffer());
    await withStore<IDBValidKey>('readwrite', s => s.put({ type: v.type, sealed } as StoredPhoto, id));
}

/** A receipt photo, for sending. Sealed photos are opened through the server (signed-in owner only). */
export async function getPhoto(id: string): Promise<File | null> {
    let v: StoredPhoto | undefined;
    try {
        v = await withStore<StoredPhoto | undefined>('readonly', s => s.get(id));
    } catch {
        return null;
    }
    if (!v) return null;
    if (v.sealed) return new File([await openBytes(v.sealed)], PHOTO_NAME, { type: v.type || 'image/jpeg' });
    return v.blob ? new File([v.blob], v.name || PHOTO_NAME, { type: v.type }) : null;
}

export async function deletePhoto(id: string): Promise<void> {
    try { await withStore('readwrite', s => s.delete(id)); } catch { /* already gone */ }
}
