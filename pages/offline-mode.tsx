// pages/offline-mode.tsx
// Offline mode: fill in the F4 financial report with no internet. Reports are kept on the phone and sent to the
// launch database once the phone is online and someone is signed in (services/offlineSync.ts). This page lists
// them with their state (waiting, sending, couldn't send and why, sent) and has a "Send now" button.
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import OfflineForm from '../components/forms/OfflineForm';
import Icon from '../components/ui/Icon';
import {
    CHANGED_EVENT, OfflineReport, deleteReport, getCachedProjects, getReports, reportTotal, updateReport,
} from '../services/offlineReports';
import { sendQueuedReports } from '../services/offlineSync';
import { newSupabase } from '../services/newSupabaseClient';

const btnGreen = 'bg-primaryGreen hover:bg-green-700 text-white font-semibold py-2.5 px-5 rounded-lg shadow inline-flex items-center justify-center gap-1.5 disabled:opacity-50';
const btnLine = 'bg-white border border-gray-300 text-gray-800 font-semibold py-2.5 px-5 rounded-lg inline-flex items-center justify-center gap-1.5 hover:bg-gray-50';

const STATUS_STYLE: Record<string, string> = {
    waiting: 'bg-amber-50 text-amber-900 border-amber-300',
    sending: 'bg-blue-50 text-blue-900 border-blue-300',
    failed: 'bg-red-50 text-red-900 border-red-300',
    sent: 'bg-emerald-50 text-emerald-900 border-emerald-300',
};

const OfflineMode: React.FC = () => {
    const { t, i18n } = useTranslation('offlineMode');
    const router = useRouter();
    const isAr = (i18n.language || 'ar').startsWith('ar');
    const [reports, setReports] = useState<OfflineReport[]>([]);
    const [isOnline, setIsOnline] = useState(true);
    const [signedIn, setSignedIn] = useState<boolean | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

    const refresh = useCallback(() => {
        const list = getReports().slice().reverse();
        setReports(list);
        // Everything sent: the "saved, will be sent" note is out of date (each report shows "Sent")
        if (!list.some(r => r.status !== 'sent')) setNotice(null);
    }, []);

    useEffect(() => {
        refresh();
        setIsOnline(navigator.onLine);
        newSupabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session)).catch(() => setSignedIn(false));
        const on = () => setIsOnline(true);
        const off = () => setIsOnline(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        window.addEventListener(CHANGED_EVENT, refresh);
        return () => {
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
            window.removeEventListener(CHANGED_EVENT, refresh);
        };
    }, [refresh]);

    const unsent = reports.filter(r => r.status !== 'sent');
    const projects = getCachedProjects().projects;

    const sendNow = async () => {
        setSending(true);
        setNotice(null);
        try {
            const res = await sendQueuedReports();
            refresh(); // first, so the result below isn't cleared
            if (res.offline) setNotice(t('notice.offline'));
            else if (res.needSignIn) setNotice(t('notice.sign_in'));
            else if (res.sent > 0 && res.failed === 0) setNotice(t('notice.sent', { count: res.sent }));
            else if (res.failed > 0) setNotice(t('notice.some_failed', { count: res.failed }));
        } finally {
            setSending(false);
        }
    };

    const fmtDate = (iso?: string) => {
        if (!iso) return '—';
        const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
        // Latin digits in both languages, as amounts and dates are typed
        return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(isAr ? 'ar-SD-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    const chooseProject = (r: OfflineReport, projectId: string) => {
        const p = projects.find(x => x.id === projectId);
        if (!p) return;
        updateReport(r.id, { project_id: p.id, project_name: p.name, err_id: p.err_id, reason: undefined, status: 'waiting' });
    };

    const statusText = (r: OfflineReport) => {
        if (r.status === 'sent') return t('status.sent', { date: fmtDate(r.sent_at) });
        if (r.status === 'sending') return t('status.sending');
        if (!r.project_id) return t('status.needs_project');
        if (r.status === 'failed') return `${t('status.failed')} ${t(`reasons.${r.reason || 'unknown'}`)}`;
        return t('status.waiting');
    };

    return (
        <div dir={isAr ? 'rtl' : 'ltr'} className="text-start min-h-screen bg-gray-100 pb-10">
            <div className={`py-2 text-center text-white text-sm font-semibold ${isOnline ? 'bg-emerald-600' : 'bg-red-600'}`} role="status">
                {isOnline ? t('status_online') : t('status_offline')}
            </div>

            <div className="max-w-lg mx-auto px-4 pt-5 space-y-4">
                <div className="flex justify-end text-sm">
                    <button onClick={() => i18n.changeLanguage('en')} className="mx-2 text-blue-600 hover:underline">English</button>
                    <button onClick={() => i18n.changeLanguage('ar')} className="mx-2 text-blue-600 hover:underline">العربية</button>
                </div>

                <section className="bg-white rounded-2xl shadow-md p-4">
                    <h1 className="text-xl font-bold text-gray-900 mb-2">{t('page.title')}</h1>
                    <ol className="list-decimal ps-5 text-sm text-gray-700 space-y-1 mb-4">
                        <li>{t('page.step_1')}</li>
                        <li>{t('page.step_2')}</li>
                        <li>{t('page.step_3')}</li>
                    </ol>
                    <button onClick={() => setFormOpen(true)} className={`${btnGreen} w-full`}>
                        <Icon name="note_add" size={20} />{t('page.new_report')}
                    </button>
                    {projects.length === 0 && (
                        <p className="text-xs text-amber-800 mt-2 mb-0">{t('form.no_projects')}</p>
                    )}
                </section>

                {notice && (
                    <div role="status" className="rounded-xl border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div>
                )}

                <section className="bg-white rounded-2xl shadow-md p-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                        <h2 className="text-lg font-bold text-gray-900 mb-0">{t('page.saved_title')}</h2>
                        {unsent.length > 0 && (
                            <button onClick={sendNow} disabled={sending || !isOnline} className={`${btnGreen} py-2 px-3 text-sm whitespace-nowrap shrink-0`}>
                                <Icon name="send" size={18} />{sending ? t('page.sending') : t('page.send_now')}
                            </button>
                        )}
                    </div>
                    {unsent.length > 0 && isOnline && signedIn === false && (
                        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 mb-3 flex flex-wrap items-center justify-between gap-2">
                            <span>{t('notice.sign_in')}</span>
                            <button onClick={() => router.push('/login')} className="text-blue-700 font-semibold inline-flex items-center gap-1">
                                <Icon name="login" size={18} />{t('page.sign_in')}
                            </button>
                        </div>
                    )}
                    {reports.length === 0 ? (
                        <p className="text-sm text-gray-600 mb-0">{t('page.none')}</p>
                    ) : (
                        <ul className="space-y-3 mb-0 ps-0 list-none">
                            {reports.map(r => (
                                <li key={r.id} className="border border-gray-200 rounded-xl p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-gray-900 mb-0 truncate"><bdi>{r.project_name || (r.legacy_err_code ? `${t('page.old_form')} · ${r.legacy_err_code}` : t('page.old_form'))}</bdi></p>
                                            <p className="text-xs text-gray-600 mb-0">
                                                {fmtDate(r.report_date)} · {t('page.expenses_count', { count: r.expenses.length })} · <span className="tabular-nums">{reportTotal(r).toLocaleString('en-US')}</span>
                                            </p>
                                        </div>
                                        <span className={`shrink-0 text-xs font-semibold border rounded-full px-2 py-0.5 ${STATUS_STYLE[!r.project_id && r.status !== 'sent' ? 'waiting' : r.status]}`}>
                                            {t(`chip.${!r.project_id && r.status !== 'sent' ? 'needs_project' : r.status}`)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-700 mt-2 mb-0">{statusText(r)}</p>

                                    {!r.project_id && r.status !== 'sent' && projects.length > 0 && (
                                        <select className="mt-2 w-full p-2 border border-gray-300 rounded-lg text-sm" defaultValue=""
                                                aria-label={t('form.project')} onChange={e => chooseProject(r, e.target.value)}>
                                            <option value="">{t('form.choose_project')}</option>
                                            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                        </select>
                                    )}

                                    {r.status !== 'sent' && r.status !== 'sending' && (
                                        confirmDelete === r.id ? (
                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                                                <span className="text-red-800">{t('page.delete_confirm')}</span>
                                                <button onClick={async () => { await deleteReport(r.id); setConfirmDelete(null); }} className="text-red-700 font-semibold inline-flex items-center gap-1">
                                                    <Icon name="delete" size={18} />{t('page.delete_yes')}
                                                </button>
                                                <button onClick={() => setConfirmDelete(null)} className="text-gray-700 inline-flex items-center gap-1">
                                                    <Icon name="close" size={18} />{t('form.cancel')}
                                                </button>
                                            </div>
                                        ) : (
                                            <button onClick={() => setConfirmDelete(r.id)} className="mt-2 text-sm text-red-700 inline-flex items-center gap-1">
                                                <Icon name="delete" size={18} />{t('page.delete')}
                                            </button>
                                        )
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <button onClick={() => { sessionStorage.setItem('fromInternalPage', 'true'); router.push('/'); }} className={`${btnLine} w-full`}>
                    <Icon name="arrow_back" size={20} />{t('return_home_button')}
                </button>
            </div>

            {formOpen && (
                <OfflineForm
                    onClose={() => setFormOpen(false)}
                    onSaved={() => { setFormOpen(false); setNotice(navigator.onLine ? t('notice.saved_sending') : t('notice.saved_offline')); refresh(); }}
                />
            )}
        </div>
    );
};

export default dynamic(() => Promise.resolve(OfflineMode), { ssr: false });
