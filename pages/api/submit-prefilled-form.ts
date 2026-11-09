// pages/api/submit-prefilled-form.ts
// Saves the prefilled F4 form (scan form, bulk PDF, prefill page) into the launch tables, through the same
// checked path as the F4 wizard (services/f4SaveCore.ts). Receipts are attached only if they went through
// the secure upload for this project. The old "MAG F4" tables are no longer written.
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAppUser } from '../../services/requireAppUser';
import { saveF4 } from '../../services/f4SaveCore';
import { f4InputFromForm, attachCleanReceipts } from '../../services/f4FromForm';
import { createProdSupabaseAdmin } from '../../services/prodSupabaseAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Signed-in, active app users only
  const caller = await requireAppUser(req, res);
  if (!caller) return;

  const body = req.body || {};
  const projectId = String(body.project_id || body.projectId || '').trim();
  if (!projectId) return res.status(400).json({ error: 'project_id is required' });

  try {
    const { input, receiptPaths } = f4InputFromForm(projectId, body, { uploadedBy: caller.user.id });
    const out = await saveF4({ accessToken: caller.token, user: caller.user, input });
    if (out.status !== 200) return res.status(out.status).json(out.json);

    const expenseIds: number[] = out.json.expense_ids || [];
    const receipts = await attachCleanReceipts(createProdSupabaseAdmin(), projectId, expenseIds, receiptPaths);
    return res.status(200).json({ ...out.json, receipts });
  } catch (e: any) {
    console.error('[submit-prefilled-form]', e?.message || e);
    return res.status(500).json({ error: 'Failed to save the report' });
  }
}
