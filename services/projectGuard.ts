// F-1 / F-4 write rules (security audit C1). The database enforces them (guard_err_projects and
// guard_err_summary triggers); the API checks the same thing first so people get a clear answer.

// Fields only the portal, admins or the review steps set. Never taken from a form.
export const PROTECTED_PROJECT_FIELDS = [
    'status', 'funding_status', 'version', 'current_feedback_id', 'grant_serial', 'grant_serial_id', 'grant_id',
    'grant_call_id', 'grant_grid_id', 'grant_segment', 'workplan_number', 'mou_id', 'approval_file_key',
    'approval_uploaded_at', 'approval_uploaded_by', 'date_transfer', 'date_report_completed', 'completed_at',
    'f4_status', 'f5_status', 'is_draft', 'created_by',
];
// (The room fields stay: the access rules already refuse a room the caller can't reach.)

/** Remove protected fields from data sent by the browser. */
export function stripProtected<T extends Record<string, unknown>>(data: T): T {
    const out: Record<string, unknown> = { ...data };
    PROTECTED_PROJECT_FIELDS.forEach(k => { delete out[k]; });
    return out as T;
}

// Statuses in which the room can still change its F-1
export const EDITABLE_STATUSES = ['draft', 'feedback'];

// Error codes raised by the database guard
export const GUARD_ERRORS = ['project_locked', 'status_change_not_allowed', 'status_not_allowed', 'protected_field', 'report_locked'];

/** The guard code in a database error message, if any. */
export function guardCode(message?: string | null): string | null {
    const m = message || '';
    return GUARD_ERRORS.find(c => m.includes(c)) || null;
}
