// Project status for the whole response (Yung, 14 Oct 2026): six statuses, shown the same way on every screen.
// The database keeps the F-System steps (pending, feedback, screened, approved, active, completed, rejected), which
// the partner portal also reads; screens translate them into these six.
//
//   Pending    F1 submitted, waiting for the F2 decision                    (pending)
//   Check-in   back with the room for clarification or changes after F2     (feedback)
//   Waiting    passed F2: working-group confirmation, contract (F3), transfer (screened, approved)
//   Active     funded and implementing; F4/F5 reporting                     (active)
//   Completed  done                                                         (completed)
//   Suspended  rejected or stopped                                          (rejected)

export type ResponseStatus = 'pending' | 'checkin' | 'waiting' | 'active' | 'completed' | 'suspended';

// Workflow order
export const RESPONSE_STATUSES: ResponseStatus[] = ['pending', 'checkin', 'waiting', 'active', 'completed', 'suspended'];

const FROM_DB: Record<string, ResponseStatus> = {
    pending: 'pending',
    feedback: 'checkin',
    screened: 'waiting',
    approved: 'waiting',
    active: 'active',
    completed: 'completed',
    rejected: 'suspended',
    suspended: 'suspended',
};

export const toResponseStatus = (s: string | null | undefined): ResponseStatus => FROM_DB[String(s || '').toLowerCase()] || 'pending';

// Chip colours (the response tracker's own: light fill, dark text; Suspended is filled) and a stronger tone for charts
export const STATUS_STYLE: Record<ResponseStatus, { bg: string; fg: string; chart: string }> = {
    completed: { bg: '#D4EDBC', fg: '#11734B', chart: '#3A9A66' },
    active:    { bg: '#BFE1F6', fg: '#0A53A8', chart: '#2F7BD0' },
    waiting:   { bg: '#FFE5A0', fg: '#473821', chart: '#E9B030' },
    checkin:   { bg: '#E6CFF2', fg: '#5A3286', chart: '#9466C6' },
    pending:   { bg: '#FFCFC9', fg: '#B10202', chart: '#EE7F72' },
    suspended: { bg: '#B10202', fg: '#FFE7E4', chart: '#B10202' },
};

/** Add up counts kept per database status into the six response statuses. */
export function toResponseCounts(counts: Record<string, number>): Record<ResponseStatus, number> {
    const out = Object.fromEntries(RESPONSE_STATUSES.map(s => [s, 0])) as Record<ResponseStatus, number>;
    Object.entries(counts || {}).forEach(([s, n]) => { out[toResponseStatus(s)] += Number(n) || 0; });
    return out;
}
