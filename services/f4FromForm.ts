/**
 * The older F4 screens (scan form, prefilled form, custom scan) send their own form shape. This turns it into
 * the input of services/f4SaveCore.ts, so they save into the same launch tables as the F4 wizard
 * (err_summary, err_expense, err_summary_attachments, receipts), never the old "MAG F4" tables.
 * Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { F4SaveInput } from './f4SaveCore';

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
const text = (v: unknown) => {
  const s = v == null ? '' : String(v).trim();
  return s && s !== 'غير متوفر' && s.toLowerCase() !== 'not available' ? s : null;
};

export type OldF4Form = {
  date?: string;
  err_id?: string;
  language?: string;
  beneficiaries?: string;
  financial_summary?: Record<string, unknown>;
  additional_questions?: Record<string, unknown>;
  expenses?: Array<Record<string, unknown>>;
  // the prefilled form's flat names
  total_grant?: unknown;
  total_other_sources?: unknown;
  additional_excess_expenses?: unknown;
  additional_surplus_use?: unknown;
  lessons_learned?: unknown;
  additional_training_needs?: unknown;
};

/** Returns the save input and, row by row, the receipt file each kept expense points at (or null). */
export function f4InputFromForm(
  projectId: string,
  form: OldF4Form,
  opts: { fileKeyTemp?: string | null; uploadedBy?: string | null } = {}
): { input: F4SaveInput; receiptPaths: Array<string | null> } {
  const fs = form.financial_summary || {};
  const aq = form.additional_questions || {};
  const rows = (Array.isArray(form.expenses) ? form.expenses : []).filter(
    (e) => text(e.activity) || text(e.description) || num(e.amount) != null
  );
  const expenses = rows.map((e) => ({
    expense_activity: text(e.activity),
    expense_description: text(e.description),
    expense_amount: num(e.amount),
    payment_date: text(e.payment_date),
    payment_method: text(e.payment_method),
    receipt_no: text(e.receipt_no),
    seller: text(e.seller),
  }));
  const spent = expenses.reduce((s, e) => s + (e.expense_amount || 0), 0);

  const summary = {
    report_date: text(form.date),
    total_grant: num(fs.total_grant_received ?? form.total_grant),
    total_other_sources: num(fs.total_other_sources ?? form.total_other_sources),
    total_expenses: num(fs.total_expenses) ?? spent,
    remainder: num(fs.remainder),
    excess_expenses: text(aq.excess_expenses ?? form.additional_excess_expenses),
    surplus_use: text(aq.surplus_use ?? form.additional_surplus_use),
    lessons: text(aq.lessons_learned ?? form.lessons_learned),
    training: text(aq.training_needs ?? form.additional_training_needs),
    beneficiaries: text(form.beneficiaries),
  };

  return {
    input: {
      project_id: projectId,
      summary,
      expenses,
      file_key_temp: opts.fileKeyTemp || null,
      uploaded_by: opts.uploadedBy || null,
    },
    receiptPaths: rows.map((e) => text(e.receipt_upload ?? e.receipt_path ?? e.uploadedUrl)),
  };
}

/**
 * Attach receipts to the saved expenses. Only files that went through the secure upload for this same
 * project (a clean row in file_uploads) are accepted; anything else is skipped and counted.
 */
export async function attachCleanReceipts(
  prod: SupabaseClient,
  projectId: string,
  expenseIds: number[],
  receiptPaths: Array<string | null>
): Promise<{ attached: number; skipped: number }> {
  let attached = 0;
  let skipped = 0;
  for (let i = 0; i < expenseIds.length; i++) {
    const path = receiptPaths[i];
    if (!path) continue;
    const { data: file } = await prod
      .from('file_uploads')
      .select('id')
      .eq('clean_path', path)
      .eq('project_id', projectId)
      .eq('status', 'clean')
      .neq('av_status', 'infected')
      .maybeSingle();
    if (!file) {
      skipped++;
      continue;
    }
    const { error } = await prod.from('receipts').insert({ expense_id: expenseIds[i], image_url: path });
    if (error) skipped++;
    else attached++;
  }
  return { attached, skipped };
}
