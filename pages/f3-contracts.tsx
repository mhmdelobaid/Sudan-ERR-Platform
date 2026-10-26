// pages/f3-contracts.tsx
// F-3: the contract (MOU) for each of the room's projects. Read-only — the MOU is made in the
// partner portal by the Partner team after the F-2 screening and the portal's final review.
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import ProjectFileLink from '../components/ui/ProjectFileLink';
import Button from '../components/ui/Button';
import { newSupabase } from '../services/newSupabaseClient';

interface Contract {
    project_id: string; project_name: string | null; project_objectives: string | null;
    state: string | null; locality: string | null; status: string; currency: string | null;
    room_name: string | null; room_name_ar: string | null; total_budget: number | string;
    has_mou: boolean; mou_code: string | null; partner_name: string | null; total_amount: number | string | null;
    start_date: string | null; end_date: string | null; transfer_date: string | null; exchange_rate: number | string | null;
    has_signed_copy: boolean; grant_serial: string | null;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <span className="block text-xs text-gray-500">{label}</span>
        <span className="text-sm font-semibold text-gray-900">{children}</span>
    </div>
);

const F3Contracts: React.FC = () => {
    const router = useRouter();
    const { t, i18n } = useTranslation('f3Contracts');
    const isAr = i18n.language === 'ar';
    const fmt = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'));
    const fmtDate = (d: string | null | undefined) =>
        d ? new Date(d).toLocaleDateString(isAr ? 'ar-SD' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const roomName = (c: Contract) => (isAr ? c.room_name_ar || c.room_name : c.room_name || c.room_name_ar) || '—';

    const [rows, setRows] = useState<Contract[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            const { data: { session } } = await newSupabase.auth.getSession();
            if (!session) { router.push('/login'); return; }
            const res = await fetch('/api/f3/contracts', { headers: { Authorization: `Bearer ${session.access_token}` } });
            if (res.status === 401) { router.push('/login'); return; }
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.code);
            setRows(data.contracts);
        })().catch((e: any) => {
            console.error('F3 load failed:', e);
            setError(t(`errors.${e?.message || 'server_error'}`, { defaultValue: t('errors.server_error') }));
            setRows([]);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    return (
        <div dir={isAr ? 'rtl' : 'ltr'} className="text-start min-h-screen bg-gray-100">
            <div className="max-w-3xl mx-auto p-4 pb-16 space-y-4">
                <div className="flex justify-end text-sm">
                    <button onClick={() => i18n.changeLanguage('en')} className="mx-2 text-blue-500 hover:underline">English</button>
                    <button onClick={() => i18n.changeLanguage('ar')} className="mx-2 text-blue-500 hover:underline">العربية</button>
                </div>
                <header className="bg-white rounded-2xl shadow-md p-4">
                    <h1 className="text-xl font-bold text-gray-900">{t('title')}</h1>
                    <p className="text-sm text-gray-600 mb-0">{t('subtitle')}</p>
                </header>

                {error && <div role="status" className="rounded-xl border p-3 text-sm bg-red-50 border-red-300 text-red-900">{error}</div>}

                {rows === null ? (
                    <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('loading')}</div>
                ) : rows.length === 0 ? (
                    <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('empty')}</div>
                ) : (
                    <ul className="space-y-3">
                        {rows.map(c => (
                            <li key={c.project_id} className="bg-white rounded-2xl shadow-md p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-bold text-gray-900 mb-0">{c.project_name || c.project_objectives || '—'}</p>
                                        <p className="text-sm text-gray-600 mb-0"><bdi>{roomName(c)}</bdi> · <bdi>{c.locality || '—'}</bdi> · <bdi>{c.state || '—'}</bdi></p>
                                        <ProjectFileLink projectId={c.project_id} step="f3" className="mt-2" />
                                    </div>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${c.has_mou ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
                                        {c.has_mou ? t('state.ready') : c.status === 'screened' ? t('state.portalReview') : t('state.preparing')}
                                    </span>
                                </div>

                                {c.has_mou ? (
                                    <>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                            <Field label={t('mouCode')}><bdi dir="ltr">{c.mou_code || '—'}</bdi></Field>
                                            <Field label={t('partner')}>{c.partner_name || '—'}</Field>
                                            <Field label={t('amount')}><bdi>{fmt(c.total_amount)} {c.currency || 'USD'}</bdi></Field>
                                            <Field label={t('start')}>{fmtDate(c.start_date)}</Field>
                                            <Field label={t('end')}>{fmtDate(c.end_date)}</Field>
                                            <Field label={t('transfer')}>{fmtDate(c.transfer_date)}</Field>
                                            {c.exchange_rate && <Field label={t('rate')}><bdi dir="ltr">{fmt(c.exchange_rate)}</bdi></Field>}
                                            {c.grant_serial && <Field label={t('serial')}><bdi dir="ltr">{c.grant_serial}</bdi></Field>}
                                        </div>
                                        <p className="text-xs text-gray-500 mb-0">{c.has_signed_copy ? t('signedInPortal') : t('notSignedYet')}</p>
                                    </>
                                ) : (
                                    <p className="text-sm text-gray-600 mb-0">
                                        {c.status === 'screened' ? t('portalReviewNote') : t('preparingNote')}
                                        {' '}<span className="text-gray-500">({t('budget')}: <bdi>{fmt(c.total_budget)} {c.currency || ''}</bdi>)</span>
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
            </div>
        </div>
    );
};

export default F3Contracts;
