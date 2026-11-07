// pages/f3-contracts.tsx
// F-3: the contract (MOU) for each of the room's projects. The MOU is made and signed by the Partner team
// in the partner portal; then the room's program officer and finance officer each sign it here with one tap,
// using the signature saved in their account (drawn the first time). The portal can't record the transfer until both have signed.
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import AppShell from '../components/layout/AppShell';
import ProjectFileLink from '../components/ui/ProjectFileLink';
import Button from '../components/ui/Button';
import SignConfirm from '../components/signatures/SignConfirm';
import { newSupabase } from '../services/newSupabaseClient';
import Icon from '../components/ui/Icon';

type Position = 'program' | 'finance';
interface Signature { name: string; signed_at: string; image: string }

interface Contract {
    project_id: string; project_name: string | null; project_objectives: string | null;
    state: string | null; locality: string | null; status: string; currency: string | null;
    room_name: string | null; room_name_ar: string | null; total_budget: number | string;
    has_mou: boolean; mou_id: string | null; mou_code: string | null; partner_name: string | null; total_amount: number | string | null;
    start_date: string | null; end_date: string | null; transfer_date: string | null; exchange_rate: number | string | null;
    has_signed_copy: boolean; grant_serial: string | null;
    partner_signed: boolean;
    signatures: Partial<Record<Position, Signature>>;
    my_position: Position | 'reporting' | null;
    my_has_signature?: boolean;
    can_sign: Position | null;
}

const POSITIONS: Position[] = ['program', 'finance'];

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
    const [notice, setNotice] = useState<string | null>(null);

    // Signing window (the shared one-tap window)
    const [signing, setSigning] = useState<{ contract: Contract; position: Position } | null>(null);

    const token = async () => {
        const { data: { session } } = await newSupabase.auth.getSession();
        if (!session) { router.push('/login'); return null; }
        return session.access_token;
    };

    const load = useCallback(async () => {
        try {
            const tk = await token();
            if (!tk) return;
            const res = await fetch('/api/f3/contracts', { headers: { Authorization: `Bearer ${tk}` } });
            if (res.status === 401) { router.push('/login'); return; }
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.code);
            setRows(data.contracts);
        } catch (e: any) {
            console.error('F3 load failed:', e);
            setError(t(`errors.${e?.message || 'server_error'}`, { defaultValue: t('errors.server_error') }));
            setRows(r => r || []);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    useEffect(() => { load(); }, [load]);

    const openSign = (contract: Contract, position: Position) => { setNotice(null); setSigning({ contract, position }); };

    const SignatureRow: React.FC<{ c: Contract; position: Position }> = ({ c, position }) => {
        const s = c.signatures?.[position];
        return (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 mb-0">{t(`sign.position.${position}`)}</p>
                    {s ? (
                        <p className="text-xs text-emerald-800 mb-0">
                            {t('sign.signedBy', { name: s.name })} · {fmtDate(s.signed_at)}
                        </p>
                    ) : (
                        <p className="text-xs text-gray-500 mb-0">{c.partner_signed ? t('sign.waitingOfficer') : t('sign.waitingPartnerShort')}</p>
                    )}
                </div>
                {s ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.image} alt={t('sign.signatureOf', { name: s.name })} className="h-12 w-28 shrink-0 object-contain bg-white" />
                ) : c.can_sign === position ? (
                    <button
                        onClick={() => openSign(c, position)}
                        className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 inline-flex items-center justify-center gap-1.5"
                    ><Icon name="signature" size={18} />
                        {t('sign.button')}
                    </button>
                ) : null}
            </div>
        );
    };

    return (
        <div dir={isAr ? 'rtl' : 'ltr'} className="text-start">
            <div className="max-w-3xl mx-auto pb-8 space-y-4">
                <header className="bg-white rounded-2xl shadow-md p-4">
                    <h1 className="text-xl font-bold text-gray-900">{t('title')}</h1>
                    <p className="text-sm text-gray-600 mb-0">{t('subtitle')}</p>
                </header>

                {error && <div role="status" className="rounded-xl border p-3 text-sm bg-red-50 border-red-300 text-red-900">{error}</div>}
                {notice && <div role="status" className="rounded-xl border p-3 text-sm bg-emerald-50 border-emerald-300 text-emerald-900">{notice}</div>}

                {rows === null ? (
                    <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('loading')}</div>
                ) : rows.length === 0 ? (
                    <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('empty')}</div>
                ) : (
                    <ul className="space-y-3">
                        {rows.map(c => {
                            const roomSigned = POSITIONS.every(p => !!c.signatures?.[p]);
                            return (
                                <li key={c.project_id} className="bg-white rounded-2xl shadow-md p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-bold text-gray-900 mb-0">{c.project_name || c.project_objectives || '—'}</p>
                                            <p className="text-sm text-gray-600 mb-0"><bdi>{roomName(c)}</bdi> · <bdi>{c.locality || '—'}</bdi> · <bdi>{c.state || '—'}</bdi></p>
                                            <ProjectFileLink projectId={c.project_id} step="f3" className="mt-2" />
                                        </div>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                                            !c.has_mou ? 'bg-amber-100 text-amber-900'
                                            : roomSigned ? 'bg-emerald-100 text-emerald-900'
                                            : c.partner_signed ? 'bg-blue-100 text-blue-900' : 'bg-amber-100 text-amber-900'}`}>
                                            {!c.has_mou ? (c.status === 'screened' ? t('state.portalReview') : t('state.preparing'))
                                                : roomSigned ? t('state.signed')
                                                : c.partner_signed ? t('state.toSign') : t('state.waitingPartner')}
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

                                            <div className="space-y-2">
                                                <p className="text-sm font-bold text-gray-900 mb-0">{t('sign.heading')}</p>
                                                <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3">
                                                    <p className="text-sm font-semibold text-gray-900 mb-0">{t('sign.partner')}</p>
                                                    <p className={`text-xs mb-0 ${c.partner_signed ? 'text-emerald-800' : 'text-gray-500'}`}>
                                                        {c.partner_signed ? t('sign.partnerSigned') : t('sign.partnerWaiting')}
                                                    </p>
                                                </div>
                                                {POSITIONS.map(p => <SignatureRow key={p} c={c} position={p} />)}
                                                <p className="text-xs text-gray-500 mb-0">
                                                    {roomSigned ? t('sign.noteDone')
                                                        : !c.partner_signed ? t('sign.notePartnerFirst')
                                                        : c.can_sign ? t('sign.noteYourTurn')
                                                        : c.my_position === 'program' || c.my_position === 'finance' ? t('sign.noteWaitingOther')
                                                        : t('sign.noteOnlyOfficers')}
                                                </p>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-sm text-gray-600 mb-0">
                                            {c.status === 'screened' ? t('portalReviewNote') : t('preparingNote')}
                                            {' '}<span className="text-gray-500">({t('budget')}: <bdi>{fmt(c.total_budget)} {c.currency || ''}</bdi>)</span>
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}

                <Button icon="arrow_back" text={t('backToMenu')} onClick={() => router.push('/home')} className="w-full" />
            </div>

            {signing && signing.contract.mou_id && (
                <SignConfirm
                    docType="f3"
                    docId={signing.contract.mou_id}
                    projectId={signing.contract.project_id}
                    title={signing.contract.mou_code || signing.contract.project_name || ''}
                    roomName={roomName(signing.contract)}
                    summary={
                        <div className="grid grid-cols-2 gap-3">
                            <Field label={t('partner')}>{signing.contract.partner_name || '—'}</Field>
                            <Field label={t('amount')}><bdi>{fmt(signing.contract.total_amount)} {signing.contract.currency || 'USD'}</bdi></Field>
                            <Field label={t('start')}>{fmtDate(signing.contract.start_date)}</Field>
                            <Field label={t('end')}>{fmtDate(signing.contract.end_date)}</Field>
                        </div>
                    }
                    onClose={() => setSigning(null)}
                    onSigned={complete => { setSigning(null); setNotice(complete ? t('sign.doneBoth') : t('sign.done')); load(); }}
                />
            )}
        </div>
    );
};

/** Inside the app's frame (menu bar, language, sign out) */
const F3ContractsInShell: React.FC = () => {
    const { t: tApp } = useTranslation('app');
    return (
        <AppShell title={tApp('nav.f3Long')}>
            <F3Contracts />
        </AppShell>
    );
};

export default F3ContractsInShell;
