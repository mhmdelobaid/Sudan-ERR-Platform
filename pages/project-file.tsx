// Project file (ملف المشروع): every F step of one project — F1 plan and budget, F2 screening, F3 contract,
// F4 financial reports, F5 programme reports — to read on screen. Each step has its own PDF button and
// prints as a separate file under a header with the LCC and ERR logos (Yung, 26 Oct 2026).
// /project-file?id=<id>&step=f3 opens the page at that step.
// Bank details and phone numbers are never included (the database leaves them out).
import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import StatusChip from '../components/ui/StatusChip';
import { newSupabase } from '../services/newSupabaseClient';

type Num = number | string | null | undefined;
interface Line {
    key: string; kind: 'activity' | 'expense'; activity_id?: string; location?: string | null;
    quantity?: Num; duration?: Num; total: Num;
    expenses?: { expense?: string; description?: string; frequency?: Num; unitPrice?: Num; unit_price?: Num; total?: Num; total_cost?: Num }[];
    expense_id?: string; description?: string; frequency?: Num; unit_price?: Num;
}
interface FileData {
    project: {
        id: string; project_name: string | null; state: string | null; state_ar: string | null; locality: string | null; locality_ar: string | null;
        status: string; version: number; currency: string | null; date: string | null; submitted_at: string | null;
        project_objectives: string | null; intended_beneficiaries: string | null; estimated_beneficiaries: Num; estimated_timeframe: string | null;
        program_officer_name: string | null; finance_officer_name: string | null; reporting_officer_name: string | null;
        additional_support: string | null; sector_primary: string | null; sector_secondary: string | null;
        room_name: string | null; room_name_ar: string | null; room_code: string | null; total_budget: Num; grant_serial: string | null; is_draft: boolean;
    };
    lines: Line[];
    activityNames: Record<string, { en: string; ar: string }>;
    expenseNames: Record<string, string>;
    f2: null | {
        outcome: string; decided_at: string; quorum: number; summary: string | null; project_version: number;
        line_outcomes: { key: string; line_no: number; label: string | null; total: Num; approve: number; conditional: number; reject: number; outcome: string; notes: string[] }[];
        ballots: { voter_name: string | null; voted_at: string; overall_note: string | null; line_votes: { key: string; verdict: string; note: string | null }[] }[];
    };
    lcc: null | { decision: string; note: string | null; decided_at: string; decided_by_name: string | null; working_group_name_ar: string | null; working_group_name_en: string | null };
    lcc_status: string;
    locality_ack: null | { acknowledged_at: string; acknowledged_by_name: string | null };
    f3: null | { mou_code: string | null; partner_name: string | null; err_name: string | null; total_amount: Num; start_date: string | null; end_date: string | null; transfer_date: string | null; exchange_rate: Num; has_signed_copy: boolean };
    f4: { id: number; report_date: string | null; total_grant: Num; total_expenses: Num; total_other_sources: Num; remainder: Num; review_status: string | null;
          excess_expenses: string | null; surplus_use: string | null; lessons: string | null; training: string | null;
          expenses: { activity: string | null; description: string | null; amount: Num; payment_date: string | null; payment_method: string | null; receipt_no: string | null }[] }[];
    f5: { id: string; report_date: string | null; reporting_person: string | null; positive_changes: string | null; negative_results: string | null;
          unexpected_results: string | null; lessons_learned: string | null; suggestions: string | null;
          reach: { activity_name: string | null; location: string | null; start_date: string | null; end_date: string | null; individuals: Num; households: Num;
                   male: Num; female: Num; under18_male: Num; under18_female: Num; disabilities: Num }[] }[];
}

type Step = 'f1' | 'f2' | 'f3' | 'f4' | 'f5';
const STEPS: Step[] = ['f1', 'f2', 'f3', 'f4', 'f5'];
// LCC logo colours (same band as the dashboard)
const LCC_BAND = ['#F2CB04', '#F13005', '#FE4D01', '#303EBB', '#5B177C'];

const num = (n: Num) => (n === null || n === undefined || n === '' ? null : Number(n));
const sum = (xs: Num[]) => xs.reduce<number>((a, x) => a + (num(x) || 0), 0);

const ProjectFile: React.FC = () => {
    const router = useRouter();
    const { t, i18n } = useTranslation('projectFile');
    const isAr = i18n.language === 'ar';
    const id = typeof router.query.id === 'string' ? router.query.id : '';

    const [data, setData] = useState<FileData | null>(null);
    const [error, setError] = useState<string | null>(null);
    // The step being printed: only that step's section is in the PDF
    const [printStep, setPrintStep] = useState<Step | null>(null);
    const askedStep = typeof router.query.step === 'string' && (STEPS as string[]).includes(router.query.step) ? router.query.step as Step : null;

    useEffect(() => {
        if (!router.isReady) return;
        if (!id) { setError(t('errors.not_found')); return; }
        (async () => {
            const { data: { session } } = await newSupabase.auth.getSession();
            if (!session) { router.push('/login'); return; }
            const res = await fetch(`/api/project-file?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
            if (res.status === 401) { router.push('/login'); return; }
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.success) throw new Error(body.code || 'server_error');
            setData(body as FileData);
        })().catch((e: any) => setError(t(`errors.${e?.message}`, { defaultValue: t('errors.server_error') })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router.isReady, id]);

    const pick = (en?: string | null, ar?: string | null) => (isAr ? ar || en : en || ar) || '';
    const fmt = (n: Num) => { const v = num(n); return v === null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }); };
    // Dates use Latin digits in Arabic too, like every other number in the file
    const dateLocale = isAr ? 'ar-SD-u-nu-latn' : 'en-GB';
    const fmtDate = (d: string | null | undefined) =>
        d ? new Date(d).toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
    // Category and payment-method names are stored in English; show them in the reader's language
    const tCat = (v: string | null | undefined) => (v ? i18n.t(v, { ns: 'projectApplication', defaultValue: v, nsSeparator: false, keySeparator: false }) : '—');
    const tPay = (v: string | null | undefined) => (v ? t(`payMethod.${v.toLowerCase()}`, { defaultValue: v }) : '—');
    // "30 days" → "30 يوم"; anything else is shown as typed
    const fmtTimeframe = (v: string | null | undefined) => {
        const m = (v || '').trim().match(/^(\d+)\s*(days?|يوم|أيام)$/i);
        return m ? t('f1.days', { n: m[1] }) : text(v);
    };
    const money = (n: Num) => `${fmt(n)} ${data?.project.currency || ''}`.trim();
    const text = (s: string | null | undefined) => (s && s.trim() ? s : '—');

    // Print one step as its own file. The browser uses the page title as the PDF's file name,
    // so the title is set to e.g. "F3 - <project>" while printing, then put back (it's "Calculator" otherwise).
    useEffect(() => {
        if (!printStep) return;
        const before = document.title;
        const name = (data?.project.project_name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80);
        document.title = `${printStep.toUpperCase()}${name ? ` - ${name}` : ''}`;
        const done = () => { document.title = before; setPrintStep(null); };
        window.addEventListener('afterprint', done, { once: true });
        const timer = window.setTimeout(() => window.print(), 50);
        return () => { window.clearTimeout(timer); window.removeEventListener('afterprint', done); document.title = before; };
    }, [printStep, data]);

    // Opened with &step=f3: go straight to that step
    useEffect(() => {
        if (data && askedStep) document.getElementById(askedStep)?.scrollIntoView({ block: 'start' });
    }, [data, askedStep]);

    const reached: Record<Step, boolean> = useMemo(() => ({
        f1: !!data,
        f2: !!data?.f2,
        f3: !!data?.f3,
        f4: !!data && data.f4.length > 0,
        f5: !!data && data.f5.length > 0,
    }), [data]);

    const lineName = (l: Line) => {
        if (l.kind === 'activity') {
            const n = l.activity_id ? data?.activityNames?.[l.activity_id] : undefined;
            return n ? (isAr ? n.ar : n.en) : t('f1.activity');
        }
        const n = l.expense_id && data?.expenseNames?.[l.expense_id];
        return (n && tCat(n)) || l.description || t('f1.item');
    };
    const expenseName = (e: { expense?: string; description?: string }) => {
        const n = e.expense && data?.expenseNames?.[e.expense];
        return (n && tCat(n)) || e.description || '—';
    };

    if (error) {
        return (
            <div dir={isAr ? 'rtl' : 'ltr'} className="text-start min-h-screen bg-gray-100 p-4">
                <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-md p-4 space-y-3">
                    <p className="mb-0 text-gray-700">{error}</p>
                    <button type="button" onClick={() => router.back()} className="rounded-lg border border-gray-300 px-4 py-2 font-semibold">{t('back')}</button>
                </div>
            </div>
        );
    }
    if (!data) return <div dir={isAr ? 'rtl' : 'ltr'} className="min-h-screen bg-gray-100 p-6 text-center text-gray-600">{t('loading')}</div>;

    const p = data.project;
    const room = pick(p.room_name, p.room_name_ar);
    const place = [pick(p.locality, p.locality_ar), pick(p.state, p.state_ar)].filter(Boolean).join(' · ');
    const printedOn = new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' });

    // Header printed at the top of every step: LCC logo left, title in the middle, ERR logo right, LCC band under it
    const Header: React.FC<{ step?: Step }> = ({ step }) => (
        <header className="pf-header">
            <div dir="ltr" className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- plain img so it is always there when printing */}
                <img src="/brand/lcc-logo.png" alt="LCC" className="h-16 w-16 object-contain shrink-0" />
                <div dir={isAr ? 'rtl' : 'ltr'} className="flex-1 min-w-0 text-center">
                    <p className="text-lg font-bold text-gray-900 mb-0">{step ? t(`steps.${step}`) : t('title')}</p>
                    <p className="text-sm text-gray-700 mb-0 break-words"><bdi>{p.project_name || '—'}</bdi></p>
                    {(room || place) && (
                        <p className="text-xs text-gray-500 mb-0 break-words">
                            {room && <bdi>{room}</bdi>}{room && place ? ' · ' : ''}{place && <bdi>{place}</bdi>}
                        </p>
                    )}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/err-logo.png" alt="ERR" className="h-16 w-14 object-contain shrink-0" />
            </div>
            <div dir="ltr" aria-hidden="true" className="flex h-1.5 mt-2">
                {LCC_BAND.map(c => <span key={c} className="flex-1" style={{ backgroundColor: c }} />)}
            </div>
        </header>
    );

    const Field: React.FC<{ label: string; children: React.ReactNode; wide?: boolean }> = ({ label, children, wide }) => (
        <div className={wide ? 'sm:col-span-2' : ''}>
            <span className="block text-xs text-gray-500">{label}</span>
            <span className="block text-sm text-gray-900 whitespace-pre-wrap break-words"><bdi>{children}</bdi></span>
        </div>
    );
    const th = 'border border-gray-300 bg-gray-50 px-2 py-1 text-start font-semibold';
    const td = 'border border-gray-300 px-2 py-1 align-top';
    const tdNum = `${td} text-end tabular-nums whitespace-nowrap`;

    const Section: React.FC<{ step: Step; children: React.ReactNode }> = ({ step, children }) => (
        <section id={step} className={`pf-page bg-white rounded-2xl shadow-md p-4 space-y-4 ${reached[step] ? '' : 'pf-empty'}`}>
            <div className="pf-print-only"><Header step={step} /></div>
            <div className="pf-screen-only flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-gray-900 mb-0">{t(`steps.${step}`)}</h2>
                {reached[step] && (
                    <button type="button" onClick={() => setPrintStep(step)}
                        className="rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white">
                        <span aria-hidden="true">⬇</span> {t('printStep', { step: step.toUpperCase() })}
                    </button>
                )}
            </div>
            {reached[step] ? children : <p className="text-sm text-gray-500 mb-0">{t('notYet')}</p>}
            <p className="pf-print-only text-[10px] text-gray-500 mb-0">{t('footer', { date: printedOn })}</p>
        </section>
    );

    return (
        <div dir={isAr ? 'rtl' : 'ltr'} className="text-start min-h-screen bg-gray-100 project-file" data-print-step={printStep || undefined}>
            <Head><title>Calculator</title></Head>
            <style jsx global>{`
                .project-file, .project-file * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .pf-print-only { display: none; }
                @media print {
                    @page { size: A4; margin: 0; } /* margin 0 = the browser prints no date, title or page address */
                    .project-file { background: #fff !important; min-height: 0 !important; } /* no blank last page */
                    .pf-screen-only, .pf-no-print { display: none !important; }
                    .pf-print-only { display: block !important; }
                    .pf-empty { display: none !important; }
                    .pf-page { box-shadow: none !important; border-radius: 0 !important; padding: 12mm !important; }
                    .project-file > div { padding: 0 !important; max-width: none !important; }
                    /* one step per file: everything except the step being printed is left out */
                    .project-file[data-print-step] .pf-page { display: none !important; }
                    .project-file[data-print-step="f1"] #f1, .project-file[data-print-step="f2"] #f2,
                    .project-file[data-print-step="f3"] #f3, .project-file[data-print-step="f4"] #f4,
                    .project-file[data-print-step="f5"] #f5 { display: block !important; }
                    /* printed without a step button (browser menu): steps start on a new page */
                    .project-file:not([data-print-step]) .pf-page + .pf-page { break-before: page; page-break-before: always; }
                    table, tr, .pf-keep { break-inside: avoid; page-break-inside: avoid; }
                }
            `}</style>

            <div className="max-w-4xl mx-auto p-4 pb-16 space-y-4">
                {/* Top bar (not printed) */}
                <div className="pf-no-print flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => router.back()}
                            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800">{t('back')}</button>
                    </div>
                    <div className="text-sm">
                        <button onClick={() => i18n.changeLanguage('en')} className="mx-2 text-blue-500 hover:underline">English</button>
                        <button onClick={() => i18n.changeLanguage('ar')} className="mx-2 text-blue-500 hover:underline">العربية</button>
                    </div>
                </div>

                <div className="pf-screen-only bg-white rounded-2xl shadow-md p-4 space-y-3">
                    <Header />
                    <div className="flex flex-wrap items-center gap-2">
                        <StatusChip status={p.status} />
                        {p.is_draft && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">{t('draft')}</span>}
                        <span className="text-xs text-gray-500">{t('printHint')}</span>
                    </div>
                    {/* Jump to a step; grey = not reached yet */}
                    <nav className="flex flex-wrap gap-2" aria-label={t('stepsNav')}>
                        {STEPS.map(s => (
                            <a key={s} href={`#${s}`}
                                className={`rounded-full px-3 py-1 text-xs font-semibold border ${reached[s] ? 'border-brand-blue bg-blue-50 text-brand-blue' : 'border-gray-200 bg-gray-50 text-gray-400'}`}>
                                {s.toUpperCase()} · {t(`short.${s}`)}{reached[s] ? '' : ` (${t('notYetShort')})`}
                            </a>
                        ))}
                    </nav>
                </div>

                {/* F1: work plan and budget */}
                <Section step="f1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pf-keep">
                        <Field label={t('f1.projectName')}>{text(p.project_name)}</Field>
                        <Field label={t('f1.room')}><bdi>{room || '—'}</bdi>{p.room_code ? <> <bdi dir="ltr">({p.room_code})</bdi></> : null}</Field>
                        <Field label={t('f1.place')}>{place || '—'}</Field>
                        <Field label={t('f1.submitted')}>{fmtDate(p.submitted_at || p.date)}</Field>
                        <Field label={t('f1.objectives')} wide>{text(p.project_objectives)}</Field>
                        <Field label={t('f1.beneficiaries')}>{text(p.intended_beneficiaries)}</Field>
                        <Field label={t('f1.estimated')}>{fmt(p.estimated_beneficiaries)}</Field>
                        <Field label={t('f1.timeframe')}>{fmtTimeframe(p.estimated_timeframe)}</Field>
                        {p.grant_serial && <Field label={t('f1.serial')}><bdi dir="ltr">{p.grant_serial}</bdi></Field>}
                        <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Field label={t('f1.programOfficer')}>{text(p.program_officer_name)}</Field>
                            <Field label={t('f1.financeOfficer')}>{text(p.finance_officer_name)}</Field>
                            <Field label={t('f1.reportingOfficer')}>{text(p.reporting_officer_name)}</Field>
                        </div>
                        {p.additional_support && <Field label={t('f1.support')} wide>{p.additional_support}</Field>}
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr>
                                    <th className={th}>#</th>
                                    <th className={th}>{t('f1.line')}</th>
                                    <th className={th}>{t('f1.details')}</th>
                                    <th className={`${th} text-end`}>{t('f1.total')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.lines.map((l, i) => (
                                    <tr key={l.key}>
                                        <td className={td}>{i + 1}</td>
                                        <td className={td}>
                                            <span className="font-semibold">{lineName(l)}</span>
                                            {l.location && <span className="block text-xs text-gray-500">{t('f1.location')}: <bdi>{l.location}</bdi></span>}
                                            {l.kind === 'activity' && <span className="block text-xs text-gray-500">{t('f1.qtyDuration', { q: fmt(l.quantity), d: fmt(l.duration) })}</span>}
                                        </td>
                                        <td className={td}>
                                            {l.kind === 'activity' ? (
                                                <ul className="space-y-0.5">
                                                    {(l.expenses || []).map((e, j) => (
                                                        <li key={j} className="text-xs">
                                                            <bdi>{expenseName(e)}</bdi>: <bdi dir="ltr">{fmt(e.frequency)} × {fmt(e.unitPrice ?? e.unit_price)} = {fmt(e.total ?? e.total_cost)}</bdi>
                                                            {e.description && e.expense && <span className="block text-[11px] text-gray-500"><bdi>{e.description}</bdi></span>}
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <span className="text-xs"><bdi dir="ltr">{fmt(l.frequency)} × {fmt(l.unit_price)}</bdi></span>
                                            )}
                                        </td>
                                        <td className={tdNum}>{fmt(l.total)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td className={`${td} font-bold`} colSpan={3}>{t('f1.budget')}</td>
                                    <td className={`${tdNum} font-bold`}>{money(p.total_budget)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <p className="pf-screen-only text-xs text-gray-500 mb-0">{t('privacyNote')}</p>
                </Section>

                {/* F2: screening decision */}
                <Section step="f2">
                    {data.f2 && (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pf-keep">
                                <Field label={t('f2.decision')}><span className="font-bold">{t(`f2.outcome.${data.f2.outcome}`, { defaultValue: data.f2.outcome })}</span></Field>
                                <Field label={t('f2.date')}>{fmtDate(data.f2.decided_at)}</Field>
                                <Field label={t('f2.quorum')}>{t('f2.quorumText', { n: data.f2.quorum, votes: data.f2.ballots.length })}</Field>
                                <Field label={t('f2.locality')} wide>
                                    {data.locality_ack ? t('f2.localityYes', { date: fmtDate(data.locality_ack.acknowledged_at), name: data.locality_ack.acknowledged_by_name || '—' }) : t('f2.localityNo')}
                                </Field>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr>
                                            <th className={th}>#</th>
                                            <th className={th}>{t('f2.line')}</th>
                                            <th className={`${th} text-end`}>{t('f1.total')}</th>
                                            <th className={th}>{t('f2.votes')}</th>
                                            <th className={th}>{t('f2.result')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.f2.line_outcomes.map(o => {
                                            const line = data.lines.find(l => l.key === o.key);
                                            return (
                                                <tr key={o.key}>
                                                    <td className={td}>{o.line_no}</td>
                                                    <td className={td}>
                                                        {line ? lineName(line) : o.label || '—'}
                                                        {o.notes?.length > 0 && <span className="block text-xs text-gray-600">{o.notes.join(' · ')}</span>}
                                                    </td>
                                                    <td className={tdNum}>{fmt(o.total)}</td>
                                                    <td className={td}><span className="text-xs">{t('f2.voteCounts', { a: o.approve, c: o.conditional, r: o.reject })}</span></td>
                                                    <td className={td}><span className="font-semibold">{t(`f2.lineOutcome.${o.outcome}`, { defaultValue: o.outcome })}</span></td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div className="space-y-1 pf-keep">
                                <p className="text-sm font-semibold text-gray-900 mb-0">{t('f2.reps')}</p>
                                <ul className="text-sm space-y-1">
                                    {data.f2.ballots.map((b, i) => (
                                        <li key={i}>
                                            <span className="font-semibold"><bdi>{b.voter_name || '—'}</bdi></span>
                                            <span className="text-xs text-gray-500"> · {fmtDate(b.voted_at)}</span>
                                            {b.overall_note && <span className="block text-xs text-gray-700">“{b.overall_note}”</span>}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="rounded-xl border border-gray-200 p-3 pf-keep">
                                <p className="text-sm font-semibold text-gray-900 mb-1">{t('f2.wg')}</p>
                                {data.lcc ? (
                                    <p className="text-sm mb-0">
                                        {t(`f2.lcc.${data.lcc.decision}`, { defaultValue: data.lcc.decision })} · {fmtDate(data.lcc.decided_at)}
                                        {data.lcc.decided_by_name ? <> · <bdi>{data.lcc.decided_by_name}</bdi></> : null}
                                        {data.lcc.note && <span className="block text-xs text-gray-700">“{data.lcc.note}”</span>}
                                    </p>
                                ) : (
                                    <p className="text-sm text-gray-500 mb-0">{t(`f2.lcc.${data.lcc_status}`, { defaultValue: t('f2.lcc.waiting') })}</p>
                                )}
                            </div>
                        </>
                    )}
                </Section>

                {/* F3: contract (MOU) */}
                <Section step="f3">
                    {data.f3 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pf-keep">
                            <Field label={t('f3.code')}><bdi dir="ltr">{text(data.f3.mou_code)}</bdi></Field>
                            <Field label={t('f3.partner')}>{text(data.f3.partner_name)}</Field>
                            <Field label={t('f3.amount')}>{money(data.f3.total_amount)}</Field>
                            <Field label={t('f3.rate')}>{fmt(data.f3.exchange_rate)}</Field>
                            <Field label={t('f3.start')}>{fmtDate(data.f3.start_date)}</Field>
                            <Field label={t('f3.end')}>{fmtDate(data.f3.end_date)}</Field>
                            <Field label={t('f3.transfer')}>{fmtDate(data.f3.transfer_date)}</Field>
                            <Field label={t('f3.signed')}>{data.f3.has_signed_copy ? t('yes') : t('no')}</Field>
                        </div>
                    )}
                </Section>

                {/* F4: financial reports */}
                <Section step="f4">
                    {data.f4.map((r, i) => (
                        <div key={r.id} className="space-y-3">
                            {data.f4.length > 1 && <p className="text-sm font-bold text-gray-900 mb-0">{t('reportN', { n: i + 1 })}</p>}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pf-keep">
                                <Field label={t('f4.date')}>{fmtDate(r.report_date)}</Field>
                                <Field label={t('f4.review')}>{t(`f4.status.${r.review_status}`, { defaultValue: r.review_status || '—' })}</Field>
                                <Field label={t('f4.grant')}>{money(r.total_grant)}</Field>
                                <Field label={t('f4.spent')}>{money(r.total_expenses)}</Field>
                                <Field label={t('f4.other')}>{money(r.total_other_sources)}</Field>
                                <Field label={t('f4.remainder')}>{money(r.remainder)}</Field>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr>
                                            <th className={th}>{t('f4.payDate')}</th>
                                            <th className={th}>{t('f4.activity')}</th>
                                            <th className={th}>{t('f4.description')}</th>
                                            <th className={th}>{t('f4.method')}</th>
                                            <th className={th}>{t('f4.receipt')}</th>
                                            <th className={`${th} text-end`}>{t('f4.amount')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {r.expenses.map((e, j) => (
                                            <tr key={j}>
                                                <td className={`${td} whitespace-nowrap`}>{fmtDate(e.payment_date)}</td>
                                                <td className={td}><bdi>{tCat(e.activity)}</bdi></td>
                                                <td className={td}><bdi>{text(e.description)}</bdi></td>
                                                <td className={td}>{tPay(e.payment_method)}</td>
                                                <td className={td}><bdi dir="ltr">{text(e.receipt_no)}</bdi></td>
                                                <td className={tdNum}>{fmt(e.amount)}</td>
                                            </tr>
                                        ))}
                                        {r.expenses.length === 0 && <tr><td className={td} colSpan={6}>{t('f4.noExpenses')}</td></tr>}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td className={`${td} font-bold`} colSpan={5}>{t('f4.total')}</td>
                                            <td className={`${tdNum} font-bold`}>{fmt(sum(r.expenses.map(e => e.amount)))}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pf-keep">
                                <Field label={t('f4.excess')}>{text(r.excess_expenses)}</Field>
                                <Field label={t('f4.surplus')}>{text(r.surplus_use)}</Field>
                                <Field label={t('f4.lessons')}>{text(r.lessons)}</Field>
                                <Field label={t('f4.training')}>{text(r.training)}</Field>
                            </div>
                        </div>
                    ))}
                </Section>

                {/* F5: programme reports */}
                <Section step="f5">
                    {data.f5.map((r, i) => (
                        <div key={r.id} className="space-y-3">
                            {data.f5.length > 1 && <p className="text-sm font-bold text-gray-900 mb-0">{t('reportN', { n: i + 1 })}</p>}
                            <div className="grid grid-cols-2 gap-3 pf-keep">
                                <Field label={t('f5.date')}>{fmtDate(r.report_date)}</Field>
                                <Field label={t('f5.person')}>{text(r.reporting_person)}</Field>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr>
                                            <th className={th}>{t('f5.activity')}</th>
                                            <th className={th}>{t('f5.dates')}</th>
                                            <th className={`${th} text-end`}>{t('f5.individuals')}</th>
                                            <th className={`${th} text-end`}>{t('f5.households')}</th>
                                            <th className={`${th} text-end`}>{t('f5.female')}</th>
                                            <th className={`${th} text-end`}>{t('f5.male')}</th>
                                            <th className={`${th} text-end`}>{t('f5.children')}</th>
                                            <th className={`${th} text-end`}>{t('f5.disabilities')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {r.reach.map((x, j) => (
                                            <tr key={j}>
                                                <td className={td}><bdi>{text(x.activity_name)}</bdi>{x.location && <span className="block text-xs text-gray-500"><bdi>{x.location}</bdi></span>}</td>
                                                <td className={`${td} text-xs`}>{fmtDate(x.start_date)} – {fmtDate(x.end_date)}</td>
                                                <td className={tdNum}>{fmt(x.individuals)}</td>
                                                <td className={tdNum}>{fmt(x.households)}</td>
                                                <td className={tdNum}>{fmt(x.female)}</td>
                                                <td className={tdNum}>{fmt(x.male)}</td>
                                                <td className={tdNum}>{fmt(sum([x.under18_female, x.under18_male]))}</td>
                                                <td className={tdNum}>{fmt(x.disabilities)}</td>
                                            </tr>
                                        ))}
                                        {r.reach.length === 0 && <tr><td className={td} colSpan={8}>{t('f5.noActivities')}</td></tr>}
                                    </tbody>
                                    {r.reach.length > 1 && (
                                        <tfoot>
                                            <tr className="font-bold">
                                                <td className={td} colSpan={2}>{t('f5.total')}</td>
                                                <td className={tdNum}>{fmt(sum(r.reach.map(x => x.individuals)))}</td>
                                                <td className={tdNum}>{fmt(sum(r.reach.map(x => x.households)))}</td>
                                                <td className={tdNum}>{fmt(sum(r.reach.map(x => x.female)))}</td>
                                                <td className={tdNum}>{fmt(sum(r.reach.map(x => x.male)))}</td>
                                                <td className={tdNum}>{fmt(sum(r.reach.flatMap(x => [x.under18_female, x.under18_male])))}</td>
                                                <td className={tdNum}>{fmt(sum(r.reach.map(x => x.disabilities)))}</td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pf-keep">
                                <Field label={t('f5.positive')}>{text(r.positive_changes)}</Field>
                                <Field label={t('f5.negative')}>{text(r.negative_results)}</Field>
                                <Field label={t('f5.unexpected')}>{text(r.unexpected_results)}</Field>
                                <Field label={t('f5.lessons')}>{text(r.lessons_learned)}</Field>
                                <Field label={t('f5.suggestions')} wide>{text(r.suggestions)}</Field>
                            </div>
                        </div>
                    ))}
                </Section>
            </div>
        </div>
    );
};

export default ProjectFile;
