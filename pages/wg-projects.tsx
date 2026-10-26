// pages/wg-projects.tsx
// Working groups (LCC level), Yung 14 Oct 2026: projects that passed F-2, grouped by state, then locality.
// Working groups don't screen; they see the F-2 result and confirm they have seen it and are OK
// with it. One confirmation sends the project on to the intermediate partner. They also follow
// F-4 / F-5 and comment. The database decides who may see and confirm what (wg_* functions).
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import ProjectFileLink from '../components/ui/ProjectFileLink';
import Button from '../components/ui/Button';
import { newSupabase } from '../services/newSupabaseClient';
import StatusChip from '../components/ui/StatusChip';

type Verdict = 'approve' | 'conditional' | 'reject';
type LccStatus = 'no_working_group' | 'waiting' | 'approved' | 'returned' | 'not_needed';

interface Group { id: string; name_en: string; name_ar: string | null; is_program_lead: boolean }
interface Core {
    id: string; project_name: string | null; state: string | null; locality: string | null; status: string;
    version: number; currency: string | null; submitted_at: string | null; total_budget: number | string;
    room_name: string | null; room_name_ar: string | null; estimated_beneficiaries: number | null;
    project_objectives?: string | null;
}
interface Lcc { decision: 'approved' | 'returned'; note: string | null; decided_at: string; decided_by_name: string | null }
interface ListRow extends Core {
    state_ar: string | null; room_locality: string | null; room_locality_ar: string | null; lcc: Lcc | null; f2_outcome: string | null;
    groups: Group[]; i_am_program: boolean; lcc_status: LccStatus; needs_my_decision: boolean;
    f4_count: number; f5_count: number; comments_count: number;
    locality_ack?: { acknowledged_at: string; acknowledged_by_name: string | null } | null;
}
interface Line {
    key: string; kind: 'activity' | 'expense'; activity_id?: string; location?: string; total: number;
    expenses?: { expense?: string; description?: string; total?: number; total_cost?: number }[];
    expense_id?: string; description?: string;
}
interface Detail {
    project: Core;
    lines: Line[];
    groups: Group[];
    f2: null | {
        outcome: 'approved' | 'conditional' | 'rejected'; decided_at: string; summary: string | null;
        line_outcomes: { key: string; line_no: number; outcome: Verdict; approve: number; conditional: number; reject: number }[];
        ballots: { voter_name: string | null; line_votes: { key: string; verdict: Verdict; note: string | null }[]; overall_note: string | null }[];
    };
    lcc: Lcc | null;
    lcc_status: LccStatus;
    can_decide: boolean;
    locality_ack?: { acknowledged_at: string; acknowledged_by_name: string | null } | null;
    f4: { id: number; report_date: string | null; total_grant: number | null; total_expenses: number | null; remainder: number | null; review_status: string | null; expense_count: number }[];
    f5: { id: string; report_date: string | null; reporting_person: string | null; positive_changes: string | null; lessons_learned: string | null;
          reach: { individuals: number; households: number; male: number; female: number; disabilities: number } }[];
    comments: { id: string; topic: string; body: string; created_at: string; author_name: string | null; is_me: boolean }[];
    activityNames: Record<string, { en: string; ar: string }>;
    expenseNames: Record<string, string>;
}

const LCC_CHIP: Record<string, string> = {
    waiting: 'bg-brand-orangeSoft text-gray-900', approved: 'bg-emerald-100 text-emerald-900',
};
const VERDICT_CHIP: Record<Verdict, string> = {
    approve: 'bg-emerald-100 text-emerald-800', conditional: 'bg-amber-100 text-amber-800', reject: 'bg-red-100 text-red-800',
};
const TOPICS = ['general', 'f1', 'f2', 'f4', 'f5'];

// Defined at module level so inputs inside them keep focus while typing (no remount per render)
const Chip: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{children}</span>
);
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="bg-white rounded-2xl shadow-md p-4 space-y-3">
        <h3 className="font-bold mb-0">{title}</h3>
        <span aria-hidden="true" className="block w-10 h-1 rounded-full bg-brand-orange" />
        {children}
    </section>
);

async function authHeaders(): Promise<Record<string, string> | null> {
    const { data: { session } } = await newSupabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

const WgProjects: React.FC = () => {
    const router = useRouter();
    const { t, i18n } = useTranslation('wgProjects');
    const isAr = i18n.language === 'ar';
    const fmt = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'));
    const fmtDate = (d: string | null | undefined) =>
        d ? new Date(d).toLocaleDateString(isAr ? 'ar-SD' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const roomName = (r: { room_name: string | null; room_name_ar: string | null }) =>
        (isAr ? r.room_name_ar || r.room_name : r.room_name || r.room_name_ar) || '—';
    const groupName = (g: { name_en: string; name_ar: string | null }) => (isAr ? g.name_ar || g.name_en : g.name_en);
    const errorText = (code?: string) => t(`errors.${code || 'server_error'}`, { defaultValue: t('errors.server_error') });

    const [auth, setAuth] = useState<'loading' | 'ok' | 'denied'>('loading');
    const [rows, setRows] = useState<ListRow[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<Detail | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [commentTopic, setCommentTopic] = useState('general');
    const [commentBody, setCommentBody] = useState('');
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [confirmNote, setConfirmNote] = useState('');
    const [noteFor, setNoteFor] = useState<string | null>(null);   // list: project whose feedback box is open

    useEffect(() => {
        (async () => {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch('/api/validate-session', { headers });
            if (!res.ok) { router.push('/login'); return; }
            const data = await res.json();
            setAuth(data.success && ['lcc_wg', 'superadmin'].includes(data.user?.role) ? 'ok' : 'denied');
        })().catch(() => router.push('/login'));
    }, [router]);

    const loadList = useCallback(async () => {
        setLoadingList(true);
        try {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch('/api/wg/projects', { headers });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.code);
            setRows(data.projects);
            setExpanded(prev => {
                if (Object.keys(prev).length > 0) return prev;
                const open: Record<string, boolean> = {};
                (data.projects as ListRow[]).forEach(r => {
                    if (r.needs_my_decision) { open[r.state || '—'] = true; open[`${r.state || '—'}|${r.room_locality || r.locality || '—'}`] = true; }
                });
                return open;
            });
        } catch (e: any) {
            console.error('WG load list failed:', e);
            setMessage({ kind: 'error', text: errorText(e?.message) });
        } finally {
            setLoadingList(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    useEffect(() => { if (auth === 'ok') loadList(); }, [auth, loadList]);

    const loadDetail = useCallback(async (id: string) => {
        setLoadingDetail(true);
        try {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch(`/api/wg/project?id=${id}`, { headers });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.code);
            setDetail(data);
        } catch (e: any) {
            console.error('WG load project failed:', e);
            setMessage({ kind: 'error', text: errorText(e?.message) });
            setSelectedId(null);
        } finally {
            setLoadingDetail(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

    const postFor = async (id: string, body: object) => {
        const headers = await authHeaders();
        if (!headers) { router.push('/login'); return null; }
        const res = await fetch(`/api/wg/project?id=${id}`, { method: 'POST', headers, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.code);
        return data;
    };
    const post = async (body: object) => (detail ? postFor(detail.project.id, body) : null);

    // "Seen and OK": one confirmation sends the project on to the intermediate partner
    const confirmProject = async (id: string, note?: string) => {
        setBusy(true); setMessage(null);
        try {
            await postFor(id, { action: 'confirm', note: note || '' });
            setMessage({ kind: 'ok', text: t('confirm.saved') });
            setConfirmNote(''); setNoteFor(null);
            if (selectedId === id) await loadDetail(id);
            await loadList();
        } catch (e: any) {
            setMessage({ kind: 'error', text: errorText(e?.message) });
        } finally {
            setBusy(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const addComment = async () => {
        if (!commentBody.trim()) return;
        setBusy(true); setMessage(null);
        try {
            await post({ action: 'comment', topic: commentTopic, body: commentBody });
            setCommentBody('');
            await loadDetail(detail!.project.id);
        } catch (e: any) {
            setMessage({ kind: 'error', text: errorText(e?.message) });
        } finally {
            setBusy(false);
        }
    };

    const openProject = (id: string) => { setMessage(null); setCommentBody(''); setConfirmNote(''); setSelectedId(id); window.scrollTo({ top: 0 }); };
    const closeProject = () => { setSelectedId(null); setMessage(null); loadList(); };

    const lineTitle = (l: Line) => {
        if (l.kind === 'activity') {
            const n = l.activity_id && detail?.activityNames[l.activity_id];
            return (n && (isAr ? n.ar : n.en)) || '—';
        }
        return (l.expense_id && detail?.expenseNames[l.expense_id]) || l.description || '—';
    };

    const langSwitch = (
        <div className="flex justify-end text-sm">
            <button onClick={() => i18n.changeLanguage('en')} className="mx-2 text-blue-500 hover:underline">English</button>
            <button onClick={() => i18n.changeLanguage('ar')} className="mx-2 text-blue-500 hover:underline">العربية</button>
        </div>
    );

    if (auth === 'loading') return <div dir={isAr ? 'rtl' : 'ltr'} className="text-start p-6 text-center text-gray-600">{t('loading')}</div>;
    if (auth === 'denied') {
        return (
            <div dir={isAr ? 'rtl' : 'ltr'} className="text-start max-w-xl mx-auto p-6 space-y-4">
                <div className="bg-white rounded-2xl shadow-md p-4 text-gray-700">{t('notAllowed')}</div>
                <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
            </div>
        );
    }

    // Group by state, states with projects waiting for confirmation first
    const stateLabel = (r: { state: string | null; state_ar?: string | null }) => (isAr ? r.state_ar || r.state : r.state) || '—';
    const byState = new Map<string, ListRow[]>();
    rows.forEach(r => {
        const k = r.state || '—';
        byState.set(k, [...(byState.get(k) || []), r]);
    });
    const localityLabel = (r: ListRow) => (isAr ? r.room_locality_ar || r.room_locality || r.locality : r.room_locality || r.locality) || '—';
    const counts = (items: ListRow[]) => ({ waiting: items.filter(r => r.needs_my_decision).length, confirmed: items.filter(r => r.lcc_status === 'approved').length });
    const states = Array.from(byState.entries())
        .map(([key, items]) => {
            // State -> localities (from each project's room)
            const byLoc = new Map<string, ListRow[]>();
            items.forEach(r => { const lk = r.room_locality || r.locality || '—'; byLoc.set(lk, [...(byLoc.get(lk) || []), r]); });
            const localities = Array.from(byLoc.entries())
                .map(([lk, li]) => ({ key: `${key}|${lk}`, label: localityLabel(li[0]), items: li, ...counts(li) }))
                .sort((a, b) => (b.waiting - a.waiting) || a.label.localeCompare(b.label));
            return { key, label: stateLabel(items[0]), items, localities, ...counts(items) };
        })
        .sort((a, b) => (b.waiting - a.waiting) || a.label.localeCompare(b.label));
    const totalWaiting = rows.filter(r => r.needs_my_decision).length;

    return (
        <div dir={isAr ? 'rtl' : 'ltr'} className="text-start min-h-screen bg-gray-100">
            <div className="max-w-3xl mx-auto p-4 pb-16 space-y-4">
                {langSwitch}
                <header className="bg-white rounded-2xl shadow-md p-4">
                    <h1 className="text-xl font-bold text-gray-900">{t('title')}</h1>
                    <p className="text-sm text-gray-600 mb-0">{t('subtitle')}</p>
                </header>

                {message && (
                    <div role="status" className={`rounded-xl border p-3 text-sm ${message.kind === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-red-50 border-red-300 text-red-900'}`}>
                        {message.text}
                    </div>
                )}

                {/* ---------- List ---------- */}
                {!selectedId && (
                    <>
                        {loadingList ? (
                            <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('loading')}</div>
                        ) : rows.length === 0 ? (
                            <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('empty.all')}</div>
                        ) : (
                            <>
                                <div className={`rounded-2xl p-4 text-sm font-semibold ${totalWaiting > 0 ? 'bg-brand-orangeSoft text-gray-900' : 'bg-white text-gray-700 shadow-md'}`}>
                                    {totalWaiting > 0 ? t('confirm.summary', { count: totalWaiting }) : t('confirm.noneWaiting')}
                                </div>
                                <ul className="space-y-3">
                                    {states.map(st => {
                                        const open = !!expanded[st.key];
                                        return (
                                            <li key={st.key} className="bg-white rounded-2xl shadow-md overflow-hidden">
                                                <button type="button" aria-expanded={open} onClick={() => setExpanded(prev => ({ ...prev, [st.key]: !open }))}
                                                    className="w-full text-start p-4 flex items-center justify-between gap-2 hover:bg-gray-50 transition">
                                                    <span className="flex items-center gap-2 min-w-0">
                                                        <span aria-hidden="true" className={`inline-block transition-transform ${open ? 'rotate-90' : isAr ? 'rotate-180' : ''}`}>▸</span>
                                                        <span className="font-bold text-gray-900 truncate">{st.label}</span>
                                                        <span className="text-xs text-gray-500">({st.items.length})</span>
                                                    </span>
                                                    <span className="flex flex-wrap items-center justify-end gap-1">
                                                        {st.waiting > 0 && <Chip className={LCC_CHIP.waiting}>{t('confirm.waitingCount', { count: st.waiting })}</Chip>}
                                                        {st.confirmed > 0 && <Chip className={LCC_CHIP.approved}>{t('confirm.confirmedCount', { count: st.confirmed })}</Chip>}
                                                    </span>
                                                </button>
                                                {open && (
                                                    <ul className="border-t border-gray-100">
                                                        {st.localities.map(lc => {
                                                            const lopen = !!expanded[lc.key];
                                                            return (
                                                    <li key={lc.key} className="border-b last:border-b-0 border-gray-100">
                                                    <button type="button" aria-expanded={lopen} onClick={() => setExpanded(prev => ({ ...prev, [lc.key]: !lopen }))}
                                                        className="w-full text-start ps-8 pe-4 py-3 flex items-center justify-between gap-2 bg-gray-50 hover:bg-gray-100 transition">
                                                        <span className="flex items-center gap-2 min-w-0">
                                                            <span aria-hidden="true" className={`inline-block text-xs transition-transform ${lopen ? 'rotate-90' : isAr ? 'rotate-180' : ''}`}>▸</span>
                                                            <span className="font-semibold text-gray-800 truncate">{lc.label}</span>
                                                            <span className="text-xs text-gray-500">({lc.items.length})</span>
                                                        </span>
                                                        <span className="flex flex-wrap items-center justify-end gap-1">
                                                            {lc.waiting > 0 && <Chip className={LCC_CHIP.waiting}>{t('confirm.waitingCount', { count: lc.waiting })}</Chip>}
                                                            {lc.confirmed > 0 && <Chip className={LCC_CHIP.approved}>{t('confirm.confirmedCount', { count: lc.confirmed })}</Chip>}
                                                        </span>
                                                    </button>
                                                    {lopen && (
                                                    <ul className="divide-y divide-gray-100">
                                                        {lc.items.map(r => (
                                                            <li key={r.id} className="p-4 space-y-3">
                                                                <button type="button" onClick={() => openProject(r.id)} className="w-full text-start group">
                                                                    <div className="flex items-start justify-between gap-2">
                                                                        <div className="min-w-0">
                                                                            <p className="font-bold text-gray-900 mb-0 group-hover:underline">{r.project_name || '—'}</p>
                                                                            <p className="text-sm text-gray-600 mb-0">{roomName(r)}</p>
                                                                            <p className={`text-xs mb-0 ${r.locality_ack ? 'text-emerald-700' : 'text-gray-500'}`}>{r.locality_ack ? `✓ ${t('localityAck.yes')}` : t('localityAck.no')}</p>
                                                                        </div>
                                                                        <StatusChip status={r.status} />
                                                                    </div>
                                                                    <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                                                                        <div><span className="block text-gray-500 text-xs">{t('card.budget')}</span><span className="font-bold text-primaryGreen"><bdi>{fmt(r.total_budget)} {r.currency || ''}</bdi></span></div>
                                                                        <div><span className="block text-gray-500 text-xs">{t('card.reports')}</span><bdi dir="ltr">F4 {r.f4_count} · F5 {r.f5_count}</bdi></div>
                                                                        <div><span className="block text-gray-500 text-xs">{t('card.comments')}</span>{r.comments_count}</div>
                                                                    </div>
                                                                </button>
                                                                {r.needs_my_decision ? (
                                                                    <div className="space-y-2">
                                                                        <Chip className={LCC_CHIP.waiting}>{t('confirm.waiting')}</Chip>
                                                                        {noteFor === r.id ? (
                                                                            <div className="space-y-2">
                                                                                <textarea rows={3} autoFocus value={confirmNote} onChange={e => setConfirmNote(e.target.value)}
                                                                                    placeholder={t('confirm.feedbackPlaceholder')} aria-label={t('confirm.feedbackButton')}
                                                                                    className="w-full rounded-lg border border-gray-300 p-2 text-sm outline-none focus:border-brand-blue" />
                                                                                <div className="grid grid-cols-2 gap-2">
                                                                                    <button type="button" disabled={busy || !confirmNote.trim()} onClick={() => confirmProject(r.id, confirmNote)}
                                                                                        className="rounded-lg bg-emerald-600 text-white text-sm font-semibold px-3 py-2 disabled:opacity-50">
                                                                                        ✓ {t('confirm.sendFeedback')}
                                                                                    </button>
                                                                                    <button type="button" disabled={busy} onClick={() => { setNoteFor(null); setConfirmNote(''); }}
                                                                                        className="rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-semibold px-3 py-2">
                                                                                        {t('confirm.cancel')}
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="grid grid-cols-2 gap-2">
                                                                                <button type="button" disabled={busy} onClick={() => confirmProject(r.id)}
                                                                                    className="rounded-lg bg-emerald-600 text-white text-sm font-semibold px-3 py-2 disabled:opacity-50">
                                                                                    ✓ {t('confirm.button')}
                                                                                </button>
                                                                                <button type="button" disabled={busy} onClick={() => { setNoteFor(r.id); setConfirmNote(''); }}
                                                                                    className="rounded-lg border-2 border-brand-blue text-brand-deep bg-white text-sm font-semibold px-3 py-2 disabled:opacity-50">
                                                                                    ✎ {t('confirm.feedbackButton')}
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : r.lcc_status === 'approved' ? (
                                                                    <div className="text-xs text-emerald-800 space-y-1">
                                                                        <p className="mb-0">✓ {t('confirm.doneBy', { name: r.lcc?.decided_by_name || '—', date: fmtDate(r.lcc?.decided_at) })}</p>
                                                                        {r.lcc?.note && <p className="mb-0 whitespace-pre-line text-gray-700 bg-gray-50 rounded-lg p-2"><strong>{t('confirm.note')}:</strong> {r.lcc.note}</p>}
                                                                    </div>
                                                                ) : r.lcc_status === 'waiting' ? (
                                                                    <Chip className={LCC_CHIP.waiting}>{t('confirm.waiting')}</Chip>
                                                                ) : null}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                    )}
                                                    </li>
                                                            );
                                                        })}
                                                    </ul>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </>
                        )}
                        <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
                    </>
                )}

                {/* ---------- One project ---------- */}
                {selectedId && (loadingDetail && !detail ? (
                    <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('loading')}</div>
                ) : detail && (
                    <>
                        <section className="bg-white rounded-2xl shadow-md p-4 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <h2 className="text-lg font-bold mb-0">{detail.project.project_name || '—'}</h2>
                                    <p className="text-sm text-gray-600 mb-0">{roomName(detail.project)} · {detail.project.locality || '—'} · {detail.project.state || '—'} · {t('card.version')} {detail.project.version}</p>
                                    <p className={`text-sm mt-1 mb-0 ${detail.locality_ack ? 'text-emerald-700' : 'text-gray-500'}`}>{detail.locality_ack ? `✓ ${t('localityAck.yes')}` : t('localityAck.no')}</p>
                                    <ProjectFileLink projectId={detail.project.id} className="mt-2" />
                                </div>
                                <StatusChip status={detail.project.status} />
                            </div>
                            {detail.groups.length > 0 && <div>
                                <span className="block text-xs text-gray-500 mb-1">{t('groups.title')}</span>
                                <div className="flex flex-wrap gap-2">
                                    {detail.groups.map(g => (
                                        <Chip key={g.id} className={g.is_program_lead ? 'bg-brand-blue text-white' : 'bg-gray-100 text-gray-700'}>
                                            {groupName(g)} · {g.is_program_lead ? t('groups.programLead') : t('groups.supporting')}
                                        </Chip>
                                    ))}
                                </div>
                            </div>}
                        </section>

                        {/* Working-group confirmation */}
                        {(detail.lcc_status === 'waiting' || detail.lcc_status === 'approved') && (
                            <Section title={t('sections.confirm')}>
                                {detail.lcc_status === 'approved' ? (
                                    <p className="text-sm text-emerald-900 mb-0">
                                        ✓ {t('confirm.doneBy', { name: detail.lcc?.decided_by_name || '—', date: fmtDate(detail.lcc?.decided_at) })}
                                        {detail.lcc?.note && <><br />{t('confirm.note')}: {detail.lcc.note}</>}
                                    </p>
                                ) : detail.can_decide ? (
                                    <div className="space-y-2">
                                        <p className="text-sm text-gray-700 mb-0">{t('confirm.help')}</p>
                                        <textarea rows={2} value={confirmNote} onChange={e => setConfirmNote(e.target.value)} placeholder={t('confirm.feedbackPlaceholder')}
                                            className="w-full rounded-lg border border-gray-300 p-2 text-sm outline-none focus:border-brand-blue" />
                                        <button type="button" disabled={busy} onClick={() => confirmProject(detail.project.id, confirmNote)}
                                            className="w-full rounded-lg bg-emerald-600 text-white font-semibold py-2 disabled:opacity-50">✓ {t('confirm.button')}</button>
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-700 mb-0">{t('confirm.waiting')}</p>
                                )}
                            </Section>
                        )}

                        {/* F-2 record */}
                        <Section title={t('sections.f2')}>
                            {!detail.f2 ? <p className="text-sm text-gray-600 mb-0">{t('f2.none')}</p> : (
                                <>
                                    <p className="text-sm mb-0"><strong>{t(`f2.outcome.${detail.f2.outcome}`)}</strong> · {t('f2.decidedAt')} {fmtDate(detail.f2.decided_at)}</p>
                                    {detail.f2.summary && <p className="text-sm whitespace-pre-line bg-gray-50 rounded-lg p-2 mb-0">{detail.f2.summary}</p>}
                                    <span className="block text-xs text-gray-500">{t('f2.votes')}</span>
                                    <ul className="space-y-1">
                                        {detail.f2.ballots.map((b, i) => (
                                            <li key={i} className="text-xs flex flex-wrap items-center gap-1">
                                                <span className="font-semibold text-gray-700">{b.voter_name || '—'}:</span>
                                                {b.line_votes.map(v => (
                                                    <span key={v.key} className={`rounded-full px-2 py-0.5 ${VERDICT_CHIP[v.verdict]}`} title={v.note || ''}>
                                                        {v.key.replace(/^[ae]/, '#')}{' '}{t(`f2.verdict.${v.verdict}`)}
                                                    </span>
                                                ))}
                                                {b.overall_note && <span className="text-gray-600">— {b.overall_note}</span>}
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </Section>

                        {/* F-1 */}
                        <Section title={t('sections.f1')}>
                            {detail.project.project_objectives && (
                                <p className="text-sm bg-gray-50 rounded-lg p-2 whitespace-pre-line mb-0"><strong>{t('f1.objectives')}:</strong> {detail.project.project_objectives}</p>
                            )}
                            <ul className="divide-y divide-gray-100">
                                {detail.lines.map((l, i) => {
                                    const lo = detail.f2?.line_outcomes?.find(x => x.key === l.key);
                                    return (
                                        <li key={l.key} className="py-2 flex items-start justify-between gap-2 text-sm">
                                            <div className="min-w-0">
                                                <span className="text-xs font-semibold text-primaryGreen">{t('f1.line', { n: i + 1 })}</span>
                                                <p className="font-semibold mb-0">{lineTitle(l)}</p>
                                                {l.location && <p className="text-xs text-gray-600 mb-0">{t('f1.location')}: {l.location}</p>}
                                            </div>
                                            <div className="text-end shrink-0">
                                                <div className="font-bold"><bdi>{fmt(l.total)}</bdi></div>
                                                {lo && <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-xs ${VERDICT_CHIP[lo.outcome]}`}>{t(`f2.verdict.${lo.outcome}`)}</span>}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                            <div className="flex items-center justify-between border-t border-gray-200 pt-2">
                                <span className="font-semibold">{t('f1.total')}</span>
                                <span className="font-bold text-primaryGreen"><bdi>{fmt(detail.project.total_budget)} {detail.project.currency || ''}</bdi></span>
                            </div>
                        </Section>

                        {/* F-4 */}
                        <Section title={t('sections.f4')}>
                            {detail.f4.length === 0 ? <p className="text-sm text-gray-600 mb-0">{t('f4.none')}</p> : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs border-collapse">
                                        <thead><tr className="bg-gray-50 text-gray-600">
                                            <th className="p-2 text-start">{t('f4.reportDate')}</th>
                                            <th className="p-2 text-end">{t('f4.totalGrant')}</th>
                                            <th className="p-2 text-end">{t('f4.totalExpenses')}</th>
                                            <th className="p-2 text-end">{t('f4.remainder')}</th>
                                            <th className="p-2 text-end">{t('f4.expenses')}</th>
                                            <th className="p-2 text-start">{t('f4.review')}</th>
                                        </tr></thead>
                                        <tbody>
                                            {detail.f4.map(r => (
                                                <tr key={r.id} className="border-t border-gray-100">
                                                    <td className="p-2">{fmtDate(r.report_date)}</td>
                                                    <td className="p-2 text-end">{fmt(r.total_grant)}</td>
                                                    <td className="p-2 text-end">{fmt(r.total_expenses)}</td>
                                                    <td className="p-2 text-end">{fmt(r.remainder)}</td>
                                                    <td className="p-2 text-end">{r.expense_count}</td>
                                                    <td className="p-2">{r.review_status || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </Section>

                        {/* F-5 */}
                        <Section title={t('sections.f5')}>
                            {detail.f5.length === 0 ? <p className="text-sm text-gray-600 mb-0">{t('f5.none')}</p> : (
                                <ul className="space-y-3">
                                    {detail.f5.map(r => (
                                        <li key={r.id} className="text-sm border border-gray-100 rounded-lg p-3 space-y-1">
                                            <p className="mb-0 text-xs text-gray-500">{t('f5.reportDate')}: {fmtDate(r.report_date)} · {t('f5.by')}: {r.reporting_person || '—'}</p>
                                            <p className="mb-0"><strong>{t('f5.reach')}:</strong>{' '}
                                                <bdi>{fmt(r.reach.individuals)}</bdi> {t('f5.individuals')} · <bdi>{fmt(r.reach.households)}</bdi> {t('f5.households')} ·{' '}
                                                <bdi>{fmt(r.reach.female)}</bdi> {t('f5.female')} · <bdi>{fmt(r.reach.male)}</bdi> {t('f5.male')} · <bdi>{fmt(r.reach.disabilities)}</bdi> {t('f5.disabilities')}
                                            </p>
                                            {r.positive_changes && <p className="mb-0"><strong>{t('f5.positive')}:</strong> {r.positive_changes}</p>}
                                            {r.lessons_learned && <p className="mb-0"><strong>{t('f5.lessons')}:</strong> {r.lessons_learned}</p>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Section>

                        {/* Comments */}
                        <Section title={t('sections.comments')}>
                            {detail.comments.length === 0 ? <p className="text-sm text-gray-600 mb-0">{t('comments.none')}</p> : (
                                <ul className="space-y-2">
                                    {detail.comments.map(c => (
                                        <li key={c.id} className={`text-sm rounded-lg p-2 ${c.is_me ? 'bg-green-50' : 'bg-gray-50'}`}>
                                            <p className="mb-1 text-xs text-gray-500">
                                                <strong className="text-gray-700">{c.is_me ? t('comments.you') : c.author_name || '—'}</strong> · {t(`comments.topics.${c.topic}`)} · {fmtDate(c.created_at)}
                                            </p>
                                            <p className="mb-0 whitespace-pre-line">{c.body}</p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm">
                                    <label htmlFor="topic" className="text-gray-600">{t('comments.topic')}</label>
                                    <select id="topic" value={commentTopic} onChange={e => setCommentTopic(e.target.value)} className="rounded-lg border border-gray-300 p-1 text-sm">
                                        {TOPICS.map(k => <option key={k} value={k}>{t(`comments.topics.${k}`)}</option>)}
                                    </select>
                                </div>
                                <textarea rows={2} value={commentBody} onChange={e => setCommentBody(e.target.value)} placeholder={t('comments.placeholder')}
                                    className="w-full rounded-lg border border-gray-300 p-2 text-sm outline-none focus:border-brand-blue" />
                                <Button text={t('comments.send')} onClick={addComment} disabled={busy || !commentBody.trim()} className="w-full" />
                            </div>
                        </Section>

                        <Button text={t('backToList')} onClick={closeProject} className="w-full" />
                    </>
                ))}
            </div>
        </div>
    );
};

export default WgProjects;
