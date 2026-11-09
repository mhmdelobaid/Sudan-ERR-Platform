// pages/api/scan-custom-form.ts
// Custom scan: one photo or PDF of a filled F4, for a project the caller can see.
//  - The file is rebuilt clean (services/cleanBeforeStore.ts: no GPS, no scripts) and kept, server-only, under
//    f4-financial-reports/<project>/tmp/ in the launch storage. /api/submit-custom-form attaches it to the report.
//  - It is read by the app's AI (lib/ai/model.ts: Claude or Gemini, the same reading as /api/ocr/process).
//  - Everything is in the launch database. Google Vision, OpenAI and the old database are no longer used.
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import formidable from 'formidable';
import { randomUUID } from 'crypto';
import { requireAppUser } from '../../services/requireAppUser';
import { createAuthenticatedClient } from '../../services/createAuthenticatedClient';
import { createProdSupabaseAdmin, isProdSupabaseConfigured } from '../../services/prodSupabaseAdmin';
import { cleanBeforeStore } from '../../services/cleanBeforeStore';
import { UPLOAD_NOT_ALLOWED } from '../../lib/uploadRules';
import { aiProvider, AI_NOT_CONFIGURED } from '../../lib/ai/model';
import { processFForm } from '../../lib/ocr/ocrProcess';
import { f4ToPrefilled } from '../../lib/ocr/f4ToPrefilled';

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

// The few project fields the scan needs, read as the signed-in user (security audit C2): the access rules
// decide whether they may see this project, and bank details, phone numbers and other fields are never read.
const SCAN_PROJECT_FIELDS =
  'id, project_name, project_objectives, intended_beneficiaries, planned_activities, expenses, err_id';

function parseForm(req: NextApiRequest): Promise<{ filePath: string; fileName: string; projectId: string }> {
  const form = formidable({ multiples: false, keepExtensions: true, maxFileSize: 20 * 1024 * 1024 });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      const entry = (files as any).image ?? (files as any).file;
      const file: formidable.File | undefined = Array.isArray(entry) ? entry[0] : entry;
      const raw = fields.projectId ?? fields.project_id;
      const projectId = String(Array.isArray(raw) ? raw[0] : raw || '').trim();
      if (!file?.filepath) return reject(Object.assign(new Error('No file uploaded'), { status: 400 }));
      resolve({ filePath: file.filepath, fileName: file.originalFilename || 'scan', projectId });
    });
  });
}

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Signed-in, active app users only (this route calls a paid AI service)
  const caller = await requireAppUser(req, res);
  if (!caller) return;

  if (!aiProvider()) {
    return res.status(503).json({ error: AI_NOT_CONFIGURED, code: 'ai_not_configured' });
  }
  if (!isProdSupabaseConfigured()) {
    return res.status(500).json({ error: 'Reporting database not configured' });
  }

  let filePath: string | null = null;
  try {
    const parsed = await parseForm(req);
    filePath = parsed.filePath;
    if (!/^[0-9a-f-]{36}$/i.test(parsed.projectId)) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    // Read as the caller: if the access rules hide the project, the scan stops here
    const db = createAuthenticatedClient(caller.token);
    const { data: project, error: projectError } = await db
      .from('err_projects')
      .select(SCAN_PROJECT_FIELDS)
      .eq('id', parsed.projectId)
      .maybeSingle();
    if (projectError) return res.status(500).json({ error: 'Failed to read the project' });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const prj: any = project;

    // Photos and PDF only, rebuilt clean before anything else touches them
    const checked = await cleanBeforeStore(fs.readFileSync(parsed.filePath));
    if (!checked.ok) {
      return res.status(checked.status!).json({ code: checked.code, error: checked.code, message: UPLOAD_NOT_ALLOWED });
    }
    const clean = checked.file!;

    const fileKey = `f4-financial-reports/${prj.id}/tmp/${Date.now()}-${randomUUID()}.${clean.ext}`;
    const { error: storeError } = await createProdSupabaseAdmin()
      .storage.from('images')
      .upload(fileKey, clean.data, { contentType: clean.mime, upsert: false, cacheControl: '0' });
    if (storeError) {
      console.error('[scan-custom-form] store', storeError.message);
      return res.status(500).json({ error: 'Failed to store the scan' });
    }

    const bytes = new Uint8Array(clean.data);
    const fileLike =
      typeof File !== 'undefined'
        ? new File([bytes], `scan.${clean.ext}`, { type: clean.mime })
        : ({
            name: `scan.${clean.ext}`,
            type: clean.mime,
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          } as File);
    const structured = await processFForm(fileLike, { form_type: 'F4', currency: 'SDG', exchange_rate: 1 });
    const form: any = f4ToPrefilled(structured, prj.err_id || '');

    // Fill what the page didn't show from the approved F1: the planned activities and the grant
    const activities = Array.isArray(prj.planned_activities)
      ? prj.planned_activities
          .map((a: any) => [a?.selectedOption || a?.activity, a?.placeOfOperation].filter(Boolean).join(' - '))
          .filter(Boolean)
          .join(', ')
      : '';
    for (const e of form.expenses || []) {
      if (!e.activity && activities) e.activity = activities;
    }
    const plannedGrant = (Array.isArray(prj.expenses) ? prj.expenses : []).reduce(
      (s: number, x: any) => s + num(x?.unitPrice) * (num(x?.frequency) || 1),
      0
    );
    const spent = (form.expenses || []).reduce((s: number, e: any) => s + num(e.amount), 0);
    const fs4 = form.financial_summary || {};
    const grant = num(fs4.total_grant_received) || plannedGrant;
    form.financial_summary = {
      ...fs4,
      total_grant_received: grant,
      total_expenses: num(fs4.total_expenses) || spent,
      remainder: num(fs4.remainder) || grant - (num(fs4.total_expenses) || spent),
    };

    return res.status(200).json({
      message: 'Scan processed successfully.',
      ocrText: form.raw_ocr || '',
      structuredData: {
        ...form,
        project_id: prj.id,
        projectMetadata: {
          id: prj.id,
          project_name: prj.project_name || null,
          objectives: prj.project_objectives || null,
          beneficiaries: prj.intended_beneficiaries || null,
        },
        fileUrl: fileKey,
      },
    });
  } catch (error: any) {
    if (error?.status === 400) return res.status(400).json({ error: error.message });
    if (error?.code === 'ai_not_configured') {
      return res.status(503).json({ error: AI_NOT_CONFIGURED, code: 'ai_not_configured' });
    }
    console.error('[scan-custom-form]', error?.message || error);
    return res.status(500).json({ error: 'Processing error. Try again.' });
  } finally {
    if (filePath) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }
}
