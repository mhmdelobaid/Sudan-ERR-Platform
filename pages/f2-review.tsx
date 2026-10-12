// pages/f2-review.tsx
// F-2 screening (قرار فرز المشروع) for the state reps committee.
// Each rep votes approve / conditional / reject on every F-1 line; the decision is made in the
// database (f2_cast_vote) once quorum is reached, so this page never decides anything itself.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button';
import { newSupabase } from '../services/newSupabaseClient';

type Verdict = 'approve' | 'conditional' | 'reject';
type Outcome = 'approved' | 'conditional' | 'rejected';

interface QueueRow {
    id: string;
    project_name: string | null;
    state: string | null;
    locality: string | null;
    room_name: string | null;
    room_name_ar: string | null;
    submitted_at: string | null;
    version: number;
    status: string;
    currency: string | null;
    total_budget: number | string;
    estimated_beneficiaries: number | null;
    votes_count: number;
    quorum: number;
    i_voted: boolean;
    decision_outcome: Outcome | null;
    decided_at: string | null;
}

interface LineExpense {
    expense?: string;
    description?: string;
    frequency?: number;
    unitPrice?: number;
    total?: number;
    total_cost?: number;
}

interface Line {
    key: string;
    kind: 'activity' | 'expense';
    activity_id?: string;
    location?: string;
    quantity?: number;
    duration?: number;
    expenses?: LineExpense[];
    expense_id?: string;
    description?: string;
    frequency?: number;
    unit_price?: number;
    total: number;
}

interface LineVote { key: string; verdict: Verdict; note: string | null }

interface Ballot {
    voter_id: string;
    voter_name: string | null;
    is_me: boolean;
    line_votes: LineVote[];
    overall_note: string | null;
    updated_at: string;
}

interface LineOutcome {
    key: string;
    line_no: number;
    outcome: Verdict;
    approve: number;
    conditional: number;
    reject: number;
}

interface Detail {
    project: {
        id: string;
        project_name: string | null;
        state: string | null;
        locality: string | null;
        status: string;
        version: number;
        currency: string | null;
        submitted_at: string | null;
        project_objectives: string | null;
        intended_beneficiaries: string | null;
        estimated_beneficiaries: number | null;
        estimated_timeframe: string | null;
        program_officer_name: string | null;
        finance_officer_name: string | null;
        reporting_officer_name: string | null;
        room_name: string | null;
        room_name_ar: string | null;
    };
    lines: Line[];
    quorum: number;
    can_vote: boolean;
    ballots: Ballot[];
    decision: null | {
        outcome: Outcome;
        project_version: number;
        line_outcomes: LineOutcome[];
        summary: string | null;
        decided_at: string;
    };
    activityNames: Record<string, { en: string; ar: string }>;
    expenseNames: Record<string, string>;
}

const VERDICT_STYLES: Record<Verdict, { on: string; off: string; chip: string; icon: string }> = {
    approve: { on: 'bg-emerald-600 text-white border-emerald-600', off: 'border-emerald-600 text-emerald-700 hover:bg-emerald-50', chip: 'bg-emerald-100 text-emerald-800', icon: '✓' },
    conditional: { on: 'bg-amber-500 text-white border-amber-500', off: 'border-amber-500 text-amber-700 hover:bg-amber-50', chip: 'bg-amber-100 text-amber-800', icon: '!' },
    reject: { on: 'bg-red-600 text-white border-red-600', off: 'border-red-600 text-red-700 hover:bg-red-50', chip: 'bg-red-100 text-red-800', icon: '✕' },
};

const OUTCOME_STYLES: Record<Outcome, string> = {
    approved: 'bg-emerald-50 border-emerald-300 text-emerald-900',
    conditional: 'bg-amber-50 border-amber-300 text-amber-900',
    rejected: 'bg-red-50 border-red-300 text-red-900',
};

const VOTER_ROLES = ['state_rep', 'admin', 'superadmin'];

async function authHeaders(): Promise<Record<string, string> | null> {
    const { data: { session } } = await newSupabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

const F2Review: React.FC = () => {
    const router = useRouter();
    const { t, i18n } = useTranslation('f2Review');
    const isAr = i18n.language === 'ar';
    const fmt = useCallback((n: number | string | null | undefined) =>
        n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'), []);
    const fmtDate = useCallback((d: string | null | undefined) =>
        d ? new Date(d).toLocaleDateString(isAr ? 'ar-SD' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—', [isAr]);

    const [auth, setAuth] = useState<'loading' | 'ok' | 'denied'>('loading');
    const [tab, setTab] = useState<'pending' | 'decided'>('pending');
    const [queue, setQueue] = useState<QueueRow[]>([]);
    const [loadingQueue, setLoadingQueue] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<Detail | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [myVotes, setMyVotes] = useState<Record<string, { verdict: Verdict | null; note: string }>>({});
    const [overallNote, setOverallNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    const errorText = (code?: string) => t(`errors.${code || 'server_error'}`, { defaultValue: t('errors.server_error') });

    // --- Auth: reps (and admins, read-only) only -------------------------------------------
    useEffect(() => {
        (async () => {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch('/api/validate-session', { headers });
            if (!res.ok) { router.push('/login'); return; }
            const data = await res.json();
            setAuth(data.success && VOTER_ROLES.includes(data.user?.role) ? 'ok' : 'denied');
        })().catch(() => router.push('/login'));
    }, [router]);

    // --- Queue -----------------------------------------------------------------------------
    const loadQueue = useCallback(async () => {
        setLoadingQueue(true);
        try {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch('/api/f2/queue', { headers });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.code);
            setQueue(data.projects);
        } catch (e: any) {
            console.error('F-2 load queue failed:', e);
            setMessage({ kind: 'error', text: errorText(e?.message) });
        } finally {
            setLoadingQueue(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    useEffect(() => { if (auth === 'ok') loadQueue(); }, [auth, loadQueue]);

    // --- One project -----------------------------------------------------------------------
    const loadDetail = useCallback(async (id: string) => {
        setLoadingDetail(true);
        try {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch(`/api/f2/project?id=${id}`, { headers });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.code);
            setDetail(data);
            const mine: Ballot | undefined = data.ballots.find((b: Ballot) => b.is_me);
            const initial: Record<string, { verdict: Verdict | null; note: string }> = {};
            (data.lines as Line[]).forEach(l => {
                const v = mine?.line_votes.find(x => x.key === l.key);
                initial[l.key] = { verdict: v?.verdict || null, note: v?.note || '' };
            });
            setMyVotes(initial);
            setOverallNote(mine?.overall_note || '');
        } catch (e: any) {
            console.error('F-2 load project failed:', e);
            setMessage({ kind: 'error', text: errorText(e?.message) });
            setSelectedId(null);
        } finally {
            setLoadingDetail(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

    const openProject = (id: string) => { setMessage(null); setSelectedId(id); window.scrollTo({ top: 0 }); };
    const closeProject = () => { setSelectedId(null); setMessage(null); loadQueue(); };

    // --- Ballot validity --------------------------------------------------------------------
    const lineDone = (key: string) => {
        const v = myVotes[key];
        if (!v?.verdict) return false;
        return v.verdict === 'approve' || v.note.trim().length > 0;
    };
    const doneCount = detail ? detail.lines.filter(l => lineDone(l.key)).length : 0;
    const ballotComplete = !!detail && detail.lines.length > 0 && doneCount === detail.lines.length;
    const iHaveVoted = !!detail?.ballots.some(b => b.is_me);
    const grandTotal = useMemo(() => (detail?.lines || []).reduce((s, l) => s + Number(l.total || 0), 0), [detail]);

    const setVerdict = (key: string, verdict: Verdict) =>
        setMyVotes(prev => ({ ...prev, [key]: { ...prev[key], verdict } }));
    const setNote = (key: string, note: string) =>
        setMyVotes(prev => ({ ...prev, [key]: { ...prev[key], note } }));

    const submitBallot = async () => {
        if (!detail || !ballotComplete) return;
        setSubmitting(true);
        setMessage(null);
        try {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch(`/api/f2/project?id=${detail.project.id}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    line_votes: detail.lines.map(l => ({ key: l.key, verdict: myVotes[l.key].verdict, note: myVotes[l.key].note })),
                    overall_note: overallNote,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.code);
            const r = data.result;
            setMessage({
                kind: 'ok',
                text: r.finalized ? t('finalized') : t('saved', { count: r.votes_count, quorum: r.quorum }),
            });
            await loadDetail(detail.project.id);
        } catch (e: any) {
            setMessage({ kind: 'error', text: errorText(e?.message) });
        } finally {
            setSubmitting(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    // --- Small pieces -------------------------------------------------------------------------
    const roomName = (r: { room_name: string | null; room_name_ar: string | null }) =>
        (isAr ? r.room_name_ar || r.room_name : r.room_name || r.room_name_ar) || '—';
    const activityName = (id?: string) =>
        (id && detail?.activityNames[id] && (isAr ? detail.activityNames[id].ar : detail.activityNames[id].en)) || '—';
    const expenseName = (e: LineExpense) => (e.expense && detail?.expenseNames[e.expense]) || e.description || '—';

    const VoteChip: React.FC<{ verdict: Verdict; label?: string }> = ({ verdict, label }) => (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${VERDICT_STYLES[verdict].chip}`}>
            <span aria-hidden>{VERDICT_STYLES[verdict].icon}</span>{label || t(`verdict.${verdict}`)}
        </span>
    );

    const QuorumBar: React.FC<{ count: number; quorum: number }> = ({ count, quorum }) => (
        <div className="flex items-center gap-2">
            <div className="flex gap-1" aria-hidden>
                {Array.from({ length: quorum }).map((_, i) => (
                    <span key={i} className={`h-2.5 w-6 rounded-full ${i < count ? 'bg-primaryGreen' : 'bg-gray-200'}`} />
                ))}
            </div>
            <span className="text-sm text-gray-600">{t('quorum.progress', { count: Math.min(count, quorum), quorum })}</span>
        </div>
    );

    const langSwitch = (
        <div className="flex justify-end text-sm">
            <button onClick={() => i18n.changeLanguage('en')} className="mx-2 text-blue-500 hover:underline">English</button>
            <button onClick={() => i18n.changeLanguage('ar')} className="mx-2 text-blue-500 hover:underline">العربية</button>
        </div>
    );

    // --- Render ---------------------------------------------------------------------------------
    if (auth === 'loading') {
        return <div dir={isAr ? 'rtl' : 'ltr'} className="p-6 text-center text-gray-600">{t('loading')}</div>;
    }
    if (auth === 'denied') {
        return (
            <div dir={isAr ? 'rtl' : 'ltr'} className="max-w-xl mx-auto p-6 space-y-4">
                <div className="bg-white rounded-2xl shadow-md p-4 text-gray-700">{t('notAllowed')}</div>
                <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
            </div>
        );
    }

    const pending = queue.filter(q => q.status === 'pending');
    const decided = queue.filter(q => q.status !== 'pending' && q.decision_outcome);
    const list = tab === 'pending' ? pending : decided;
    const stateName = queue[0]?.state;

    return (
        <div dir={isAr ? 'rtl' : 'ltr'} className="min-h-screen bg-gray-100">
            <div className="max-w-3xl mx-auto p-4 pb-32 space-y-4">
                {langSwitch}

                {/* Header */}
                <header className="bg-white rounded-2xl shadow-md p-4">
                    <h1 className="text-xl font-bold text-gray-900">{t('title')}</h1>
                    <p className="text-sm text-gray-600 mb-0">{t('subtitle')}</p>
                    {stateName && (
                        <p className="mt-2 mb-0 text-sm">
                            <span className="text-gray-500">{t('stateLabel')}: </span>
                            <span className="font-semibold text-primaryGreen">{stateName}</span>
                        </p>
                    )}
                </header>

                {message && (
                    <div role="status" className={`rounded-xl border p-3 text-sm ${message.kind === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-red-50 border-red-300 text-red-900'}`}>
                        {message.text}
                    </div>
                )}

                {/* ---------------- List ---------------- */}
                {!selectedId && (
                    <>
                        <div className="flex gap-2">
                            {(['pending', 'decided'] as const).map(k => (
                                <button
                                    key={k}
                                    onClick={() => setTab(k)}
                                    className={`flex-1 rounded-xl py-2 text-sm font-semibold border transition ${tab === k ? 'bg-primaryGreen text-white border-primaryGreen' : 'bg-white text-gray-700 border-gray-300'}`}
                                >
                                    {t(`tabs.${k}`)} ({k === 'pending' ? pending.length : decided.length})
                                </button>
                            ))}
                        </div>

                        {loadingQueue ? (
                            <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('loading')}</div>
                        ) : list.length === 0 ? (
                            <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">
                                {tab === 'pending' ? t('emptyPending') : t('emptyDecided')}
                            </div>
                        ) : (
                            <ul className="space-y-3">
                                {list.map(q => (
                                    <li key={q.id}>
                                        <button
                                            onClick={() => openProject(q.id)}
                                            className="w-full text-start bg-white rounded-2xl shadow-md p-4 border border-transparent hover:border-brand-blue transition"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <p className="font-bold text-gray-900 mb-0">{q.project_name || '—'}</p>
                                                    <p className="text-sm text-gray-600 mb-0">{roomName(q)} · {q.locality || '—'}</p>
                                                </div>
                                                {q.decision_outcome && q.status !== 'pending' ? (
                                                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${OUTCOME_STYLES[q.decision_outcome]}`}>
                                                        {t(`decision.${q.decision_outcome}`)}
                                                    </span>
                                                ) : (
                                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${q.i_voted ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'}`}>
                                                        {q.i_voted ? t('card.youVoted') : t('card.notVoted')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                                                <div>
                                                    <span className="block text-gray-500 text-xs">{t('card.budget')}</span>
                                                    <span className="font-bold text-primaryGreen">{fmt(q.total_budget)} {q.currency || ''}</span>
                                                </div>
                                                <div>
                                                    <span className="block text-gray-500 text-xs">{t('card.beneficiaries')}</span>
                                                    <span className="font-semibold">{fmt(q.estimated_beneficiaries)}</span>
                                                </div>
                                                <div>
                                                    <span className="block text-gray-500 text-xs">{q.status === 'pending' ? t('card.submitted') : t('decision.decidedAt')}</span>
                                                    <span>{fmtDate(q.status === 'pending' ? q.submitted_at : q.decided_at)}</span>
                                                </div>
                                                <div>
                                                    <span className="block text-gray-500 text-xs">{t('card.version')}</span>
                                                    <span>{q.version}</span>
                                                </div>
                                            </div>
                                            {q.status === 'pending' && (
                                                <div className="mt-3"><QuorumBar count={q.votes_count} quorum={q.quorum} /></div>
                                            )}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

                        <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
                    </>
                )}

                {/* ---------------- One project ---------------- */}
                {selectedId && (loadingDetail && !detail ? (
                    <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('loading')}</div>
                ) : detail && (
                    <>
                        {/* Project summary */}
                        <section className="bg-white rounded-2xl shadow-md p-4 space-y-3">
                            <div>
                                <h2 className="text-lg font-bold mb-0">{detail.project.project_name || '—'}</h2>
                                <p className="text-sm text-gray-600 mb-0">
                                    {roomName(detail.project)} · {detail.project.locality || '—'} · {t('card.version')} {detail.project.version}
                                </p>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                                <div>
                                    <span className="block text-gray-500 text-xs">{t('card.budget')}</span>
                                    <span className="font-bold text-primaryGreen text-base">{fmt(grandTotal)} {detail.project.currency || ''}</span>
                                </div>
                                <div>
                                    <span className="block text-gray-500 text-xs">{t('card.beneficiaries')}</span>
                                    <span className="font-semibold">{fmt(detail.project.estimated_beneficiaries)}</span>
                                </div>
                                <div>
                                    <span className="block text-gray-500 text-xs">{t('card.submitted')}</span>
                                    <span>{fmtDate(detail.project.submitted_at)}</span>
                                </div>
                            </div>
                            {detail.project.project_objectives && (
                                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                                    <span className="block font-semibold mb-1">{t('details.objectives')}</span>
                                    <p className="mb-0 whitespace-pre-line">{detail.project.project_objectives}</p>
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                                {detail.project.intended_beneficiaries && (
                                    <p className="mb-0"><strong>{t('details.intendedBeneficiaries')}:</strong> {detail.project.intended_beneficiaries}</p>
                                )}
                                {detail.project.estimated_timeframe && (
                                    <p className="mb-0"><strong>{t('details.timeframe')}:</strong> {detail.project.estimated_timeframe}</p>
                                )}
                                {detail.project.program_officer_name && (
                                    <p className="mb-0"><strong>{t('details.programOfficer')}:</strong> {detail.project.program_officer_name}</p>
                                )}
                                {detail.project.finance_officer_name && (
                                    <p className="mb-0"><strong>{t('details.financeOfficer')}:</strong> {detail.project.finance_officer_name}</p>
                                )}
                            </div>
                        </section>

                        {/* Decision (once quorum is reached) */}
                        {detail.decision && detail.project.status !== 'pending' && (
                            <section className={`rounded-2xl border-2 p-4 space-y-2 ${OUTCOME_STYLES[detail.decision.outcome]}`}>
                                <h3 className="font-bold mb-0">{t('decision.title')}: {t(`decision.${detail.decision.outcome}`)}</h3>
                                <p className="text-sm mb-0">{t('decision.decidedAt')}: {fmtDate(detail.decision.decided_at)}</p>
                                {detail.decision.summary && (
                                    <div className="bg-white/70 rounded-lg p-3 text-sm">
                                        <span className="block font-semibold mb-1">{t('decision.summary')}</span>
                                        <p className="mb-0 whitespace-pre-line">{detail.decision.summary}</p>
                                    </div>
                                )}
                            </section>
                        )}

                        {/* Quorum */}
                        <section className="bg-white rounded-2xl shadow-md p-4 space-y-2">
                            <h3 className="font-bold mb-0">{t('quorum.title')}</h3>
                            <QuorumBar count={detail.ballots.length} quorum={detail.quorum} />
                            {detail.ballots.length > 0 && (
                                <ul className="flex flex-wrap gap-2">
                                    {detail.ballots.map(b => (
                                        <li key={b.voter_id} className={`rounded-full px-3 py-1 text-xs ${b.is_me ? 'bg-primaryGreen text-white' : 'bg-gray-100 text-gray-700'}`}>
                                            {b.voter_name || '—'}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {detail.can_vote && <p className="text-xs text-gray-500 mb-0">{t('quorum.help', { quorum: detail.quorum })}</p>}
                            {!detail.can_vote && detail.project.status === 'pending' && (
                                <p className="text-xs text-gray-500 mb-0">{t('readOnly')}</p>
                            )}
                        </section>

                        {/* Lines */}
                        <section className="space-y-3">
                            <h3 className="font-bold px-1 mb-0">{t('lines.title')}</h3>
                            {detail.lines.map((l, idx) => {
                                const others = detail.ballots
                                    .filter(b => !b.is_me || !detail.can_vote) // while voting, your own vote is the buttons below
                                    .map(b => ({ name: b.voter_name, v: b.line_votes.find(x => x.key === l.key) }))
                                    .filter(x => x.v);
                                const lo = detail.decision?.line_outcomes?.find(x => x.key === l.key);
                                const mine = myVotes[l.key];
                                return (
                                    <article key={l.key} className="bg-white rounded-2xl shadow-md p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <span className="text-xs font-semibold text-primaryGreen">{t('lines.line', { n: idx + 1 })}</span>
                                                <p className="font-bold mb-0">
                                                    {l.kind === 'activity' ? activityName(l.activity_id) : expenseName({ expense: l.expense_id, description: l.description })}
                                                </p>
                                                {l.kind === 'activity' && (
                                                    <p className="text-xs text-gray-600 mb-0">
                                                        {t('lines.location')}: {l.location || '—'} · {t('lines.quantity')}: {fmt(l.quantity)} · {t('lines.duration')}: {fmt(l.duration)}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="text-end shrink-0">
                                                <span className="block text-xs text-gray-500">{t('lines.lineTotal')}</span>
                                                <span className="font-bold">{fmt(l.total)}</span>
                                            </div>
                                        </div>

                                        {/* Expense breakdown */}
                                        {l.kind === 'activity' && (l.expenses || []).length > 0 && (
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-xs border-collapse">
                                                    <thead>
                                                        <tr className="bg-gray-50 text-gray-600">
                                                            <th className="p-2 text-start font-semibold">{t('lines.expense')}</th>
                                                            <th className="p-2 text-start font-semibold">{t('lines.description')}</th>
                                                            <th className="p-2 text-end font-semibold">{t('lines.frequency')}</th>
                                                            <th className="p-2 text-end font-semibold">{t('lines.unitPrice')}</th>
                                                            <th className="p-2 text-end font-semibold">{t('lines.total')}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(l.expenses || []).map((e, i) => (
                                                            <tr key={i} className="border-t border-gray-100">
                                                                <td className="p-2">{expenseName({ expense: e.expense })}</td>
                                                                <td className="p-2 text-gray-600">{e.description || '—'}</td>
                                                                <td className="p-2 text-end">{fmt(e.frequency)}</td>
                                                                <td className="p-2 text-end">{fmt(e.unitPrice)}</td>
                                                                <td className="p-2 text-end font-semibold">{fmt(e.total ?? e.total_cost)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                        {l.kind === 'expense' && (
                                            <p className="text-xs text-gray-600 mb-0">
                                                {t('lines.frequency')}: {fmt(l.frequency)} · {t('lines.unitPrice')}: {fmt(l.unit_price)}
                                            </p>
                                        )}

                                        {/* Final line outcome */}
                                        {lo && detail.project.status !== 'pending' && (
                                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                                <VoteChip verdict={lo.outcome} />
                                                <span className="text-gray-600">{t('decision.tally', { a: lo.approve, c: lo.conditional, r: lo.reject })}</span>
                                            </div>
                                        )}

                                        {/* Other reps' votes */}
                                        <div className="border-t border-gray-100 pt-2">
                                            <span className="block text-xs text-gray-500 mb-1">{t('lines.otherVotes')}</span>
                                            {others.length === 0 ? (
                                                <span className="text-xs text-gray-400">{t('lines.noVotesYet')}</span>
                                            ) : (
                                                <ul className="space-y-1">
                                                    {others.map((o, i) => (
                                                        <li key={i} className="text-xs flex flex-wrap items-center gap-2">
                                                            <span className="font-semibold text-gray-700">{o.name || '—'}</span>
                                                            <VoteChip verdict={o.v!.verdict} />
                                                            {o.v!.note && <span className="text-gray-600">{o.v!.note}</span>}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>

                                        {/* My vote */}
                                        {detail.can_vote && (
                                            <div className="border-t border-gray-100 pt-3 space-y-2">
                                                <span className="block text-xs font-semibold text-gray-700">{t('lines.yourVote')}</span>
                                                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('lines.yourVote')}>
                                                    {(['approve', 'conditional', 'reject'] as Verdict[]).map(v => (
                                                        <button
                                                            key={v}
                                                            type="button"
                                                            role="radio"
                                                            aria-checked={mine?.verdict === v}
                                                            onClick={() => setVerdict(l.key, v)}
                                                            className={`rounded-lg border-2 py-2 text-sm font-semibold transition ${mine?.verdict === v ? VERDICT_STYLES[v].on : `bg-white ${VERDICT_STYLES[v].off}`}`}
                                                        >
                                                            <span aria-hidden className="me-1">{VERDICT_STYLES[v].icon}</span>{t(`verdict.${v}`)}
                                                        </button>
                                                    ))}
                                                </div>
                                                {mine?.verdict && (
                                                    <textarea
                                                        rows={2}
                                                        value={mine.note}
                                                        onChange={e => setNote(l.key, e.target.value)}
                                                        placeholder={mine.verdict === 'approve' ? t('lines.noteOptional') : t('lines.notePlaceholder')}
                                                        className={`w-full rounded-lg border p-2 text-sm outline-none focus:border-primaryGreen ${mine.verdict !== 'approve' && !mine.note.trim() ? 'border-red-400' : 'border-gray-300'}`}
                                                    />
                                                )}
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                            <div className="bg-white rounded-2xl shadow-md p-4 flex items-center justify-between">
                                <span className="font-semibold">{t('lines.grandTotal')}</span>
                                <span className="font-bold text-primaryGreen text-lg">{fmt(grandTotal)} {detail.project.currency || ''}</span>
                            </div>
                        </section>

                        {detail.can_vote && (
                            <section className="bg-white rounded-2xl shadow-md p-4">
                                <label htmlFor="overall-note" className="block text-sm font-semibold mb-1">{t('overallNote')}</label>
                                <textarea
                                    id="overall-note"
                                    rows={3}
                                    value={overallNote}
                                    onChange={e => setOverallNote(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 p-2 text-sm outline-none focus:border-primaryGreen"
                                />
                            </section>
                        )}

                        <Button text={t('backToList')} onClick={closeProject} className="w-full" />

                        {/* Sticky submit bar */}
                        {detail.can_vote && (
                            <div className="fixed bottom-0 inset-x-0 bg-white/95 border-t border-gray-200 p-3 z-50">
                                <div className="max-w-3xl mx-auto space-y-1">
                                    {!ballotComplete && (
                                        <p className="text-xs text-gray-600 mb-0 text-center">
                                            {t('missing', { done: doneCount, total: detail.lines.length })}
                                        </p>
                                    )}
                                    <Button
                                        text={submitting ? t('submitting') : iHaveVoted ? t('update') : t('submit')}
                                        onClick={submitBallot}
                                        disabled={!ballotComplete || submitting}
                                        className="w-full h-12 font-bold"
                                    />
                                </div>
                            </div>
                        )}
                    </>
                ))}
            </div>
        </div>
    );
};

export default F2Review;
