// pages/signatures.tsx
// "Waiting for my signature": the documents of the officer's room that need their signature (F3 now; F1, F4
// and F5 as they are added), each opened in the project file first and signed with one tap, plus what they
// signed recently. Only the room's program, finance and reporting officers sign.
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import AppShell from '../components/layout/AppShell';
import Button from '../components/ui/Button';
import ProjectFileLink from '../components/ui/ProjectFileLink';
import SignConfirm from '../components/signatures/SignConfirm';
import { DocType, errorCode, fetchMySignatures } from '../components/signatures/signApi';
import Icon from '../components/ui/Icon';

interface QueueItem {
    doc_type: DocType; doc_id: string; project_id: string | null; project_name: string | null;
    title: string | null; partner_name?: string | null; amount?: number | string | null; currency?: string | null;
    room_name: string | null; room_name_ar: string | null; date: string | null;
    signatures?: Record<string, { name: string; signed_at: string }>;
}
interface RecentItem { doc_type: DocType; doc_id: string; signed_at: string; title: string | null; project_id: string | null; project_name: string | null }

const card = 'bg-white rounded-2xl shadow-md p-4';

const SignaturesPage: React.FC = () => {
    const router = useRouter();
    const { t, i18n } = useTranslation('signatures');
    const isAr = i18n.language === 'ar';
    const fmt = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'));
    const fmtDate = (d: string | null | undefined) =>
        d ? new Date(d).toLocaleDateString(isAr ? 'ar-SD' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

    const [data, setData] = useState<Awaited<ReturnType<typeof fetchMySignatures>> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [signing, setSigning] = useState<QueueItem | null>(null);

    const load = useCallback(async () => {
        try {
            setError(null);
            setData(await fetchMySignatures());
        } catch (e: any) {
            const code = errorCode(e?.message);
            if (code === 'unauthorized') { router.push('/login'); return; }
            setError(t(`errors.${code}`, { defaultValue: t('errors.server_error') }));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);
    useEffect(() => { load(); }, [load]);

    const roomName = (it: { room_name: string | null; room_name_ar: string | null }) =>
        (isAr ? it.room_name_ar || it.room_name : it.room_name || it.room_name_ar) || '—';

    const me = data?.me;
    const queue = (data?.queue || []) as QueueItem[];
    const recent = (data?.recent || []) as RecentItem[];

    return (
        <div dir={isAr ? 'rtl' : 'ltr'} className="text-start">
            <div className="max-w-3xl mx-auto pb-8 space-y-4">
                <header className={`${card} space-y-1`}>
                    <h1 className="text-xl font-bold text-gray-900 mb-0">{t('title')}</h1>
                    <p className="text-sm text-gray-600 mb-0">{t('subtitle')}</p>
                    {me?.officer_position && (
                        <p className="text-sm font-semibold text-blue-800 mb-0">{t('youSignAs', { position: t(`position.${me.officer_position}`) })}</p>
                    )}
                    {me && me.officer_position && !me.has_signature && (
                        <p className="text-xs text-gray-600 mb-0">
                            {t('noSavedSignature')}{' '}
                            <button type="button" className="font-semibold text-blue-700 underline inline-flex items-center justify-center gap-1.5" onClick={() => router.push('/profile')}><Icon name="account_circle" size={16} />{t('goToProfile')}</button>
                        </p>
                    )}
                </header>

                {error && <div role="status" className="rounded-xl border p-3 text-sm bg-red-50 border-red-300 text-red-900">{error}</div>}
                {notice && <div role="status" className="rounded-xl border p-3 text-sm bg-emerald-50 border-emerald-300 text-emerald-900">{notice}</div>}

                {!data && !error ? (
                    <div className={`${card} text-gray-600`}>{t('loading')}</div>
                ) : me && !me.officer_position ? (
                    <div className={`${card} text-sm text-gray-700`}>{t('notOfficer')}</div>
                ) : (
                    <section className="space-y-3" aria-labelledby="sig-queue">
                        <h2 id="sig-queue" className="sr-only">{t('title')}</h2>
                        {queue.length === 0 ? (
                            <div className={`${card} text-gray-600`}>{t('empty')}</div>
                        ) : (
                            <ul className="space-y-3">
                                {queue.map(it => {
                                    const others = Object.values(it.signatures || {}).map(s => s.name);
                                    return (
                                        <li key={`${it.doc_type}-${it.doc_id}`} className={`${card} space-y-3`}>
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900">{t(`docType.${it.doc_type}`)}</span>
                                                    <p className="font-bold text-gray-900 mb-0 mt-1 break-words">{it.project_name || '—'}</p>
                                                    <p className="text-sm text-gray-600 mb-0"><bdi>{roomName(it)}</bdi></p>
                                                </div>
                                                <button onClick={() => { setNotice(null); setSigning(it); }}
                                                    className="shrink-0 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 inline-flex items-center justify-center gap-1.5"><Icon name="signature" size={18} />
                                                    {t('sign')}
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                                                {it.title && <div><span className="block text-xs text-gray-500">{t('code')}</span><bdi dir="ltr" className="font-semibold break-all">{it.title}</bdi></div>}
                                                {it.partner_name && <div><span className="block text-xs text-gray-500">{t('partner')}</span><span className="font-semibold">{it.partner_name}</span></div>}
                                                {it.amount !== undefined && it.amount !== null && <div><span className="block text-xs text-gray-500">{t('amount')}</span><bdi className="font-semibold">{fmt(it.amount)} {it.currency || 'USD'}</bdi></div>}
                                            </div>
                                            {others.length > 0 && <p className="text-xs text-emerald-800 mb-0">{t('alsoSigned', { names: others.join(isAr ? '، ' : ', ') })}</p>}
                                            {it.project_id && <ProjectFileLink projectId={it.project_id} step={it.doc_type} />}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                )}

                {me?.officer_position && (
                    <section className={`${card} space-y-2`} aria-labelledby="sig-recent">
                        <h2 id="sig-recent" className="text-base font-bold text-gray-900 mb-0">{t('recentTitle')}</h2>
                        {recent.length === 0 ? (
                            <p className="text-sm text-gray-600 mb-0">{t('recentEmpty')}</p>
                        ) : (
                            <ul className="divide-y divide-gray-100">
                                {recent.map(r => (
                                    <li key={`${r.doc_type}-${r.doc_id}`} className="py-2 flex items-center justify-between gap-2 text-sm">
                                        <div className="min-w-0">
                                            <span className="font-semibold text-gray-900">{t(`docType.${r.doc_type}`)}</span>
                                            <span className="text-gray-600"> · <bdi>{r.project_name || r.title || '—'}</bdi></span>
                                        </div>
                                        <span className="shrink-0 text-xs text-gray-500">{t('signedOn', { date: fmtDate(r.signed_at) })}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                )}

                <Button icon="arrow_back" text={t('backToMenu')} onClick={() => router.push('/home')} className="w-full" />
            </div>

            {signing && (
                <SignConfirm
                    docType={signing.doc_type}
                    docId={signing.doc_id}
                    projectId={signing.project_id}
                    title={signing.project_name || signing.title || ''}
                    roomName={roomName(signing)}
                    summary={signing.title ? (
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div><span className="block text-xs text-gray-500">{t('code')}</span><bdi dir="ltr" className="font-semibold break-all">{signing.title}</bdi></div>
                            {signing.amount !== undefined && signing.amount !== null && (
                                <div><span className="block text-xs text-gray-500">{t('amount')}</span><bdi className="font-semibold">{fmt(signing.amount)} {signing.currency || 'USD'}</bdi></div>
                            )}
                        </div>
                    ) : undefined}
                    onClose={() => setSigning(null)}
                    onSigned={complete => { setSigning(null); setNotice(complete ? t('doneComplete') : t('done')); load(); }}
                />
            )}
        </div>
    );
};

/** Inside the app's frame (menu bar, language, sign out) */
const SignaturesPageInShell: React.FC = () => {
    const { t: tApp } = useTranslation('app');
    return (
        <AppShell title={tApp('cards.signatures.title')}>
            <SignaturesPage />
        </AppShell>
    );
};

export default SignaturesPageInShell;
