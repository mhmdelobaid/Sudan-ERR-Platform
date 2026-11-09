// pages/api/submit-custom-form.ts
// Saves the reviewed custom scan (scan-custom-form → CustomFormReview) into the launch tables, through the
// same checked path as the F4 wizard (services/f4SaveCore.ts). The scanned page itself was stored clean by
// /api/scan-custom-form under f4-financial-reports/<project>/tmp/, and becomes the report's attachment.
// The old "MAG F4" tables are no longer written.
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAppUser } from '../../services/requireAppUser';
import { saveF4 } from '../../services/f4SaveCore';
import { f4InputFromForm } from '../../services/f4FromForm';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Signed-in, active app users only
  const caller = await requireAppUser(req, res);
  if (!caller) return;

  const body = req.body || {};
  const projectId = String(body.project_id || body.project?.id || body.projectMetadata?.id || '').trim();
  if (!projectId) return res.status(400).json({ error: 'project_id is required' });

  try {
    const { input } = f4InputFromForm(projectId, body, {
      fileKeyTemp: typeof body.fileUrl === 'string' ? body.fileUrl : null,
      uploadedBy: caller.user.id,
    });
    if (!input.summary.project_objectives && body.projectMetadata?.objectives) {
      input.summary.project_objectives = String(body.projectMetadata.objectives);
    }
    const out = await saveF4({ accessToken: caller.token, user: caller.user, input });
    return res.status(out.status).json(out.json);
  } catch (e: any) {
    console.error('[submit-custom-form]', e?.message || e);
    return res.status(500).json({ error: 'Failed to save the report' });
  }
}
