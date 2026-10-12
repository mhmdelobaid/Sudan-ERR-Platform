// pages/wg-projects.tsx
// Working groups (LCC level): follow the projects they run across states, give the LCC-level
// approval when they are the program lead group, follow F-4 / F-5 reports, and comment.
// Every check and decision is made in the database (wg_* functions); this page only shows them.
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button';
import { newSupabase } from '../services/newSupabaseClient';

type Verdict = 'approve' | 'conditional' | 'reject';
type LccStatus = 'no_working_group' | 'waiting' | 'approved' | 'returned';

interface Group { id: string; name_en: string; name_ar: string | null; is_program_lead: boolean }
interface Core {
    id: string; project_name: string | null; state: string | null; locality: string | null; status: string;
    version: number; currency: string | null; submitted_at: string | null; total_budget: number | string;
    room_name: string | null; room_name_ar: string | null; estimated_beneficiaries: number | null;
    project_objectives?: string | null;
}
interface ListRow extends Core {
    groups: Group[]; i_am_program: boolean; lcc_status: LccStatus; needs_my_decision: boolean;
    f4_count: number; f5_count: number; comments_count: number;
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
    lcc: null | { decision: 'approved' | 'returned'; note: string | null; decided_at: string; decided_by_name: string | null };
    lcc_status: LccStatus;
    can_decide: boolean;
    f4: { id: number; report_date: string | null; total_grant: number | null; total_expenses: number | null; remainder: number | null; review_status: string | null; expense_count: number }[];
    f5: { id: string; report_date: string | null; reporting_person: string | null; positive_changes: string | null; lessons_learned: string | null;
          reach: { individuals: number; households: number; male: number; female: number; disabilities: number } }[];
    comments: { id: string; topic: string; body: string; created_at: string; author_name: string | null; is_me: boolean }[];
    activityNames: Record<string, { en: string; ar: string }>;
    expenseNames: Record<string, string>;
}

const STATUS_CHIP: Record<string, string> = {
    pending: 'bg-orange-100 text-orange-800', feedback: 'bg-orange-200 text-orange-900', screened: 'bg-brand-orangeSoft text-gray-900',
    approved: 'bg-green-100 text-green-900', active: 'bg-green-200 text-green-900', completed: 'bg-green-800 text-white',
    rejected: 'bg-gray-200 text-gray-800',
};
const LCC_CHIP: Record<LccStatus, string> = {
    no_working_group: 'bg-gray-100 text-gray-700', waiting: 'bg-amber-100 text-amber-900',
    approved: 'bg-emerald-100 text-emerald-900', returned: 'bg-red-100 text-red-900',
};
const VERDICT_CHIP: Record<Verdict, string> = {
    approve: 'bg-emerald-100 text-emerald-800', conditional: 'bg-amber-100 text-amber-800', reject: 'bg-red-100 text-red-800',
};
const TOPICS = ['general', 'f1', 'f2', 'lcc', 'f4', 'f5'];

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
    const [tab, setTab] = useState<'needsDecision' | 'all'>('needsDecision');
    const [rows, setRows] = useState<ListRow[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<Detail | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [lccNote, setLccNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [commentTopic, setCommentTopic] = useState('general');
    const [commentBody, setCommentBody] = useState('');

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
            if (!data.projects.some((r: ListRow) => r.needs_my_decision)) setTab('all');
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

    const post = async (body: object) => {
        if (!detail) return null;
        const headers = await authHeaders();
        if (!headers) { router.push('/login'); return null; }
        const res = await fetch(`/api/wg/project?id=${detail.project.id}`, { method: 'POST', headers, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.code);
        return data;
    };

    const decide = async (decision: 'approved' | 'returned') => {
        setBusy(true); setMessage(null);
        try {
            await post({ action: 'decide', decision, note: lccNote });
            setMessage({ kind: 'ok', text: t('lcc.saved') });
            setLccNote('');
            await loadDetail(detail!.project.id);
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

    const openProject = (id: string) => { setMessage(null); setLccNote(''); setCommentBody(''); setSelectedId(id); window.scrollTo({ top: 0 }); };
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

    if (auth === 'loading') return <div dir={isAr ? 'rtl' : 'ltr'} className="p-6 text-center text-gray-600">{t('loading')}</div>;
    if (auth === 'denied') {
        return (
            <div dir={isAr ? 'rtl' : 'ltr'} className="max-w-xl mx-auto p-6 space-y-4">
                <div className="bg-white rounded-2xl shadow-md p-4 text-gray-700">{t('notAllowed')}</div>
                <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
            </div>
        );
    }

    const needs = rows.filter(r => r.needs_my_decision);
    const list = tab === 'needsDecision' ? needs : rows;

    return (
        <div dir={isAr ? 'rtl' : 'ltr'} className="min-h-screen bg-gray-100">
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
                        <div className="flex gap-2">
                            {(['needsDecision', 'all'] as const).map(k => (
                                <button key={k} onClick={() => setTab(k)}
                                    className={`flex-1 rounded-xl py-2 text-sm font-semibold border transition ${tab === k ? 'bg-primaryGreen text-white border-primaryGreen' : 'bg-white text-gray-700 border-gray-300'}`}>
                                    {t(`tabs.${k}`)} ({k === 'needsDecision' ? needs.length : rows.length})
                                </button>
                            ))}
                        </div>
                        {loadingList ? (
                            <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('loading')}</div>
                        ) : list.length === 0 ? (
                            <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t(`empty.${tab}`)}</div>
                        ) : (
                            <ul className="space-y-3">
                                {list.map(r => (
                                    <li key={r.id}>
                                        <button onClick={() => openProject(r.id)}
                                            className="w-full text-start bg-white rounded-2xl shadow-md p-4 border border-transparent hover:border-brand-blue transition">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="font-bold text-gray-900 mb-0">{r.project_name || '—'}</p>
                                                    <p className="text-sm text-gray-600 mb-0">{roomName(r)} · {r.state || '—'}</p>
                                                </div>
                                                <Chip className={STATUS_CHIP[r.status] || 'bg-gray-100 text-gray-700'}>{t(`status.${r.status}`, { defaultValue: r.status })}</Chip>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
                                                <Chip className={LCC_CHIP[r.lcc_status]}>{t(`lccStatus.${r.lcc_status}`)}</Chip>
                                                {r.groups.map(g => (
                                                    <Chip key={g.id} className={g.is_program_lead ? 'bg-brand-blue text-white' : 'bg-gray-100 text-gray-700'}>{groupName(g)}</Chip>
                                                ))}
                                            </div>
                                            <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                                                <div><span className="block text-gray-500 text-xs">{t('card.budget')}</span><span className="font-bold text-primaryGreen"><bdi>{fmt(r.total_budget)} {r.currency || ''}</bdi></span></div>
                                                <div><span className="block text-gray-500 text-xs">{t('card.reports')}</span><bdi dir="ltr">F4 {r.f4_count} · F5 {r.f5_count}</bdi></div>
                                                <div><span className="block text-gray-500 text-xs">{t('card.comments')}</span>{r.comments_count}</div>
                                            </div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
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
                                </div>
                                <Chip className={STATUS_CHIP[detail.project.status] || 'bg-gray-100 text-gray-700'}>{t(`status.${detail.project.status}`, { defaultValue: detail.project.status })}</Chip>
                            </div>
                            <div>
                                <span className="block text-xs text-gray-500 mb-1">{t('groups.title')}</span>
                                <div className="flex flex-wrap gap-2">
                                    {detail.groups.map(g => (
                                        <Chip key={g.id} className={g.is_program_lead ? 'bg-brand-blue text-white' : 'bg-gray-100 text-gray-700'}>
                                            {groupName(g)} · {g.is_program_lead ? t('groups.programLead') : t('groups.supporting')}
                                        </Chip>
                                    ))}
                                </div>
                            </div>
                        </section>

                        {/* LCC approval */}
                        <Section title={t('sections.lcc')}>
                            <div className="flex flex-wrap items-center gap-2"><Chip className={LCC_CHIP[detail.lcc_status]}>{t(`lccStatus.${detail.lcc_status}`)}</Chip></div>
                            {detail.lcc && (
                                <p className="text-sm mb-0">
                                    {t('lcc.decidedBy')}: <strong>{detail.lcc.decided_by_name || '—'}</strong> {t('lcc.decidedAt')} {fmtDate(detail.lcc.decided_at)}
                                    {detail.lcc.note && <><br />{t('lcc.note')}: {detail.lcc.note}</>}
                                </p>
                            )}
                            <p className="text-xs text-gray-500 mb-0">{t('lcc.help')}</p>
                            {detail.can_decide ? (
                                <div className="space-y-2">
                                    <textarea rows={2} value={lccNote} onChange={e => setLccNote(e.target.value)} placeholder={t('lcc.notePlaceholder')}
                                        className="w-full rounded-lg border border-gray-300 p-2 text-sm outline-none focus:border-brand-blue" />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <button type="button" disabled={busy} onClick={() => decide('approved')}
                                            className="rounded-lg bg-emerald-600 text-white font-semibold py-2 disabled:opacity-50">✓ {t('lcc.approve')}</button>
                                        <button type="button" disabled={busy || !lccNote.trim()} onClick={() => decide('returned')}
                                            className="rounded-lg border-2 border-red-600 text-red-700 bg-white font-semibold py-2 disabled:opacity-50">↩ {t('lcc.return')}</button>
                                    </div>
                                </div>
                            ) : detail.project.status === 'screened' && detail.lcc_status === 'waiting' ? (
                                <p className="text-xs text-gray-600 mb-0">{t('lcc.onlyProgram')}</p>
                            ) : !detail.lcc && detail.project.status === 'pending' ? (
                                <p className="text-xs text-gray-600 mb-0">{t('lcc.notYet')}</p>
                            ) : null}
                        </Section>

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
