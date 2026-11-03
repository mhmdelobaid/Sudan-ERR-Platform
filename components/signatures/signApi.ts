// components/signatures/signApi.ts
// Talking to the signature functions: what's waiting for me, and signing one document.
import { newSupabase } from '../../services/newSupabaseClient';

export type DocType = 'f1' | 'f3' | 'f4' | 'f5';
export type OfficerPosition = 'program' | 'finance' | 'reporting';
export interface DocSignature { name: string; signed_at: string; image: string }

export const SIGN_ERRORS = [
    'not_a_signer', 'no_saved_signature', 'not_your_room', 'partner_not_signed', 'already_signed',
    'invalid_signature', 'invalid_document', 'not_active', 'unauthorized', 'not_found',
];

/** The known error code inside a Supabase / API error message, or 'server_error'. */
export const errorCode = (message?: string | null) =>
    SIGN_ERRORS.find(c => (message || '').includes(c)) || 'server_error';

async function token() {
    const { data: { session } } = await newSupabase.auth.getSession();
    return session?.access_token || null;
}

export async function fetchMySignatures() {
    const tk = await token();
    if (!tk) throw new Error('unauthorized');
    const res = await fetch('/api/signatures', { headers: { Authorization: `Bearer ${tk}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.code || 'server_error');
    return data.signatures as {
        me: { officer_position: OfficerPosition | null; has_signature: boolean; room_name: string | null; room_name_ar: string | null };
        queue: any[];
        recent: any[];
    };
}

export async function signDocument(docType: DocType, docId: string) {
    const tk = await token();
    if (!tk) throw new Error('unauthorized');
    const res = await fetch('/api/signatures/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ doc_type: docType, doc_id: docId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.code || 'server_error');
    return data.result as { doc_type: DocType; doc_id: string; signatures: Record<string, DocSignature>; complete: boolean };
}

/** Save (or replace) the caller's own signature. */
export async function saveMySignature(png: string) {
    const { data, error } = await newSupabase.rpc('me_set_signature', { p_png: png });
    if (error) throw new Error(errorCode(error.message));
    return data as { has_signature: boolean; signature_png: string; signature_updated_at: string };
}
