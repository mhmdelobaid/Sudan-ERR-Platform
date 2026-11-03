// POST /api/signatures/sign — the caller signs one document with their saved signature.
// Body: { doc_type: 'f1' | 'f3' | 'f4' | 'f5', doc_id }
// The database (sign_document) checks everything: the caller's officer position for that document, their room,
// a saved signature, the document's state (e.g. F3: the partner signed first), and that they haven't signed it yet.
import { NextApiRequest, NextApiResponse } from 'next';
import { getCaller, isUuid, sendRpcError, withJsonErrors } from '../../../services/f2Api';

const DOC_TYPES = ['f1', 'f3', 'f4', 'f5'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ success: false, code: 'method_not_allowed' });
    }
    const { doc_type, doc_id } = req.body || {};
    if (!DOC_TYPES.includes(doc_type) || !isUuid(doc_id)) {
        return res.status(400).json({ success: false, code: 'invalid_document' });
    }
    const caller = await getCaller(req, res);
    if (!caller) return;
    const { data, error } = await caller.client.rpc('sign_document', { p_doc_type: doc_type, p_doc_id: doc_id });
    if (error) return sendRpcError(res, error);
    return res.status(200).json({ success: true, result: data });
}

export default withJsonErrors(handler);
