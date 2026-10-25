// Account import: read a pasted list or CSV file and guess each person's role and room.
// Used by the import panel on the User Management page. The database checks everything again
// (um_import_check / um_import_user), so these guesses only save the admin typing.

export interface ImportRoom {
    id: string; name: string | null; name_ar: string | null; type: string | null; err_code: string | null;
    state?: string | null; state_ar?: string | null; locality?: string | null; locality_ar?: string | null;
}

export interface ParsedRow {
    row: number;          // line number in the list, for messages ("row 14")
    name: string;
    email: string;
    position: string;     // as written in the list
    roomText: string;     // as written in the list
}

// Roles a list can give (admin, superadmin and partner are set up one by one).
export const IMPORT_ROLES = ['base_err', 'locality_err', 'state_err', 'state_rep', 'lcc_wg', 'support'] as const;
export type ImportRole = typeof IMPORT_ROLES[number];

// The room type each role needs: null = no room, 'any' = any room.
export const IMPORT_ROOM_FOR: Record<ImportRole, string | null> = {
    base_err: 'base', locality_err: 'locality', state_err: 'state', state_rep: 'any', lcc_wg: null, support: null,
};

/** Lower-case, trim, and make Arabic spelling variants compare equal (أ/إ/آ→ا, ة→ه, ى→ي, no tashkeel). */
export function norm(s: string | null | undefined): string {
    return (s || '')
        .normalize('NFKC')
        .replace(/[ً-ْـ]/g, '')     // tashkeel and tatweel
        .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
        .toLowerCase()
        .replace(/[\s ]+/g, ' ')
        .trim();
}

// ---------- reading the list ----------

/** Split pasted text or a CSV file into cells. Handles tabs (pasted from Sheets/Excel), commas and quotes. */
export function splitTable(text: string): string[][] {
    const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const firstLine = clean.split('\n').find(l => l.trim()) || '';
    const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
    const rows: string[][] = [];
    let row: string[] = [], cell = '', quoted = false;
    for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        if (quoted) {
            if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"' && cell === '') quoted = true;
        else if (c === sep) { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += c;
    }
    row.push(cell); rows.push(row);
    return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
}

const HEADER_WORDS: Record<keyof Omit<ParsedRow, 'row'>, string[]> = {
    name: ['name', 'full name', 'الاسم', 'اسم', 'الاسم الكامل'],
    email: ['email', 'e-mail', 'mail', 'البريد', 'البريد الالكتروني', 'الايميل', 'ايميل'],
    position: ['position', 'role', 'title', 'الصفه', 'الوظيفه', 'المنصب', 'الدور', 'المهمه'],
    roomText: ['room', 'err', 'base err', 'emergency room', 'الغرفه', 'غرفه الطوارئ', 'الغرفه القاعديه', 'المحليه', 'locality'],
};

/** Turn cells into rows. Uses the header line when it has one; otherwise the order name, email, position, room. */
export function parseList(text: string): { rows: ParsedRow[]; hadHeader: boolean } {
    const table = splitTable(text);
    if (table.length === 0) return { rows: [], hadHeader: false };
    const head = table[0].map(norm);
    const col: Partial<Record<keyof Omit<ParsedRow, 'row'>, number>> = {};
    (Object.keys(HEADER_WORDS) as (keyof typeof HEADER_WORDS)[]).forEach(key => {
        const i = head.findIndex((h, idx) => !Object.values(col).includes(idx) && HEADER_WORDS[key].some(w => h === norm(w) || h.startsWith(norm(w) + ' ')));
        if (i >= 0) col[key] = i;
    });
    const hadHeader = col.email !== undefined || col.name !== undefined;
    const idx = hadHeader
        ? { name: col.name ?? -1, email: col.email ?? -1, position: col.position ?? -1, roomText: col.roomText ?? -1 }
        : { name: 0, email: 1, position: 2, roomText: 3 };
    const body = hadHeader ? table.slice(1) : table;
    const start = hadHeader ? 2 : 1;
    return {
        hadHeader,
        rows: body.map((cells, i) => ({
            row: start + i,
            name: idx.name >= 0 ? cells[idx.name] || '' : '',
            email: (idx.email >= 0 ? cells[idx.email] || '' : '').replace(/^mailto:/i, '').trim(),
            position: idx.position >= 0 ? cells[idx.position] || '' : '',
            roomText: idx.roomText >= 0 ? cells[idx.roomText] || '' : '',
        })),
    };
}

// ---------- position -> role ----------

// Checked in this order: "ممثل الولاية" is a state rep, not a state room member.
const POSITION_WORDS: [ImportRole, string[]][] = [
    ['state_rep', ['state_rep', 'state rep', 'rep', 'representative', 'committee', 'f2', 'ممثل', 'مندوب', 'لجنه', 'لجنة']],
    ['lcc_wg', ['lcc_wg', 'working group', 'wg', 'lcc', 'مجموعه عمل', 'مجموعات العمل', 'فريق عمل']],
    ['support', ['support', 'دعم', 'الدعم الفني']],
    ['base_err', ['base_err', 'base', 'قاعدي', 'قاعديه', 'غرفه قاعديه', 'الغرفه القاعديه']],
    ['locality_err', ['locality_err', 'locality', 'محليه', 'غرفه محليه', 'غرفه المحليه']],
    ['state_err', ['state_err', 'state', 'ولايه', 'ولائي', 'ولائيه', 'غرفه ولائيه', 'غرفه الولايه']],
];

export function guessRole(position: string): ImportRole | null {
    const p = norm(position);
    if (!p) return null;
    if ((IMPORT_ROLES as readonly string[]).includes(p)) return p as ImportRole;
    for (const [role, words] of POSITION_WORDS) {
        if (words.some(w => { const n = norm(w); return p === n || new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(p); })) return role;
    }
    return null;
}

// ---------- room text -> room ----------

const ROOM_FILLER = ['غرفه طوارئ', 'غرف طوارئ', 'غرفه الطوارئ', 'غرفه', 'تجريبي', 'emergency response room', 'emergency room', 'err', 'room', 'test', 'base', 'locality', 'state'];
function core(s: string | null | undefined): string {
    let x = norm(s).replace(/[()\[\]،,.\-_/]/g, ' ');
    ROOM_FILLER.forEach(w => { x = x.replace(new RegExp(`(^|\\s)${norm(w)}(?=\\s|$)`, 'g'), ' '); });
    return x.replace(/\s+/g, ' ').trim();
}

/** Find the room a row names. Returns the room when exactly one fits the role, otherwise how many fit. */
export function matchRoom(rooms: ImportRoom[], text: string, role: ImportRole | null): { room: ImportRoom | null; candidates: number } {
    const need = role ? IMPORT_ROOM_FOR[role] : 'any';
    if (!text.trim() || need === null) return { room: null, candidates: 0 };
    const pool = rooms.filter(r => need === 'any' || r.type === need);
    const t = norm(text);
    const exact = pool.filter(r => [r.name, r.name_ar, r.err_code].some(v => v && norm(v) === t));
    if (exact.length === 1) return { room: exact[0], candidates: 1 };
    if (exact.length > 1) return { room: null, candidates: exact.length };
    const c = core(text);
    if (!c) return { room: null, candidates: 0 };
    const loose = pool.filter(r => [r.name, r.name_ar].some(v => v && core(v) === c));
    if (loose.length === 1) return { room: loose[0], candidates: 1 };
    return { room: null, candidates: loose.length };
}

/** A label for a room in pick lists: "Name (CODE) — locality · state". */
export function roomLabel(r: ImportRoom, isAr: boolean): string {
    const pick = (en?: string | null, ar?: string | null) => (isAr ? ar || en : en || ar) || '';
    const place = [pick(r.locality, r.locality_ar), pick(r.state, r.state_ar)].filter(Boolean).join(' · ');
    return `${pick(r.name, r.name_ar)}${r.err_code ? ` (${r.err_code})` : ''}${place ? ` — ${place}` : ''}`;
}

/** The template people fill in, as CSV with a BOM so Excel shows Arabic correctly. */
export function templateCsv(isAr: boolean): string {
    const head = isAr ? ['الاسم', 'البريد الإلكتروني', 'الصفة', 'الغرفة'] : ['name', 'email', 'position', 'room'];
    const example = isAr
        ? ['محمد أحمد', 'name@example.com', 'عضو غرفة قاعدية', 'اسم الغرفة القاعدية كما في المنصة']
        : ['Mohamed Ahmed', 'name@example.com', 'base ERR member', 'Room name as it appears in the app'];
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    return '﻿' + [head, example].map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}
