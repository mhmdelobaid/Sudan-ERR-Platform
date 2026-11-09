// State exchange rates (SDG per 1 USD). Decision 10 Nov 2026: the PARTNER sets each state's rate and it applies at
// once; a FINANCE member of a national working group then acknowledges it. F1 uploads use the rate of the room's
// state, and each F1 records its state's rate when it is sent (err_projects.exchange_rate). Every rate is kept.
// Who may do what comes from the database (can_set, can_acknowledge); others see the rates only.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AppShell from '../components/layout/AppShell';
import { useRequireAuth } from '../hooks/useRequireAuth';

type StateRate = {
    state_name: string; state_name_ar: string | null; sdg_per_usd: number | null;
    set_at: string | null; set_by_name: string | null;
    acknowledged_at: string | null; acknowledged_by_name: string | null;
};

const PAGE_ROLES = ['partner', 'lcc_wg', 'admin', 'superadmin'];
const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

export default function StateRatesPage() {
    const { t, i18n } = useTranslation('app');
    const isAr = i18n.language?.startsWith('ar');
    const { ready, token, role } = useRequireAuth();
    const [rows, setRows] = useState<StateRate[]>([]);
    const [canSet, setCanSet] = useState(false);
    const [canAck, setCanAck] = useState(false);
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    const errText = (code: string) => t(`rates.errors.${code}`, { defaultValue: t('rates.errors.server_error') });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/state-rates', { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.code || 'server_error');
            setRows(data.states || []);
            setCanSet(!!data.can_set);
            setCanAck(!!data.can_acknowledge);
        } catch (e: any) {
            setMessage({ kind: 'error', text: errText(e.message) });
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    useEffect(() => { if (ready && PAGE_ROLES.includes(role || '')) load(); }, [ready, role, load]);

    const label = (r: StateRate) => (isAr ? r.state_name_ar || r.state_name : r.state_name);
    const sorted = useMemo(() => [...rows].sort((a, b) => label(a).localeCompare(label(b))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [rows, isAr]);
    const fmtDate = (d: string | null) =>
        d ? new Date(d).toLocaleDateString(isAr ? 'ar-SD-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

    const post = async (r: StateRate, body: object, okText: string) => {
        setBusy(r.state_name);
        setMessage(null);
        try {
            const res = await fetch('/api/state-rates', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: r.state_name, ...body }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.code || 'server_error');
            setEdits(e => { const { [r.state_name]: _drop, ...rest } = e; return rest; });
            await load();
            setMessage({ kind: 'ok', text: okText });
        } catch (e: any) {
            setMessage({ kind: 'error', text: errText(e.message) });
        } finally {
            setBusy(null);
        }
    };

    const save = (r: StateRate) => {
        const raw = (edits[r.state_name] ?? '').replace(/,/g, '').trim();
        const rate = Number(raw);
        if (!raw || !Number.isFinite(rate) || rate <= 0) {
            setMessage({ kind: 'error', text: errText('invalid_rate') });
            return;
        }
        post(r, { rate }, t('rates.saved', { state: label(r) }));
    };

    if (!ready) {
        return <AppShell title={t('rates.title')}><p className="text-[#a8b6cc] text-sm">{t('common.loading')}</p></AppShell>;
    }
    if (!PAGE_ROLES.includes(role || '')) {
        return <AppShell title={t('rates.title')}><div className="app-panel p-4 text-sm text-[#a8b6cc]">{t('rates.onlyAllowed')}</div></AppShell>;
    }

    return (
        <AppShell title={t('rates.title')}>
            <p className="text-sm text-[#a8b6cc] mb-4">{t('rates.intro')}</p>
            {message && (
                <div role="status" className={`rounded-xl p-3 text-sm mb-3 ${message.kind === 'ok' ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/30' : 'bg-red-500/15 text-red-200 border border-red-400/30'}`}>
                    {message.text}
                </div>
            )}
            {loading ? (
                <p className="text-[#a8b6cc] text-sm">{t('common.loading')}</p>
            ) : (
                <ul className="space-y-2 ps-0 list-none">
                    {sorted.map(r => {
                        const value = edits[r.state_name] ?? '';
                        const isSet = r.sdg_per_usd != null;
                        const acked = !!r.acknowledged_at;
                        return (
                            <li key={r.state_name} className="app-panel p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-white mb-0"><bdi>{label(r)}</bdi></p>
                                        <p className="text-xs text-[#8a97ab] mb-0">
                                            {isSet
                                                ? <><bdi dir="ltr">1 USD = {fmt(Number(r.sdg_per_usd))} SDG</bdi>{r.set_at && <> · {t('rates.setOn', { date: fmtDate(r.set_at), name: r.set_by_name || '—' })}</>}</>
                                                : t('rates.notSet')}
                                        </p>
                                        {isSet && (
                                            <p className={`text-xs mt-1 mb-0 font-semibold ${acked ? 'text-emerald-300' : 'text-amber-300'}`}>
                                                {acked
                                                    ? t('rates.acknowledged', { name: r.acknowledged_by_name || '—', date: fmtDate(r.acknowledged_at) })
                                                    : t('rates.waiting')}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {canAck && isSet && !acked && (
                                            <button type="button" onClick={() => post(r, { acknowledge: true }, t('rates.acknowledgedOk', { state: label(r) }))}
                                                disabled={busy === r.state_name}
                                                className="px-3 py-2 rounded-lg text-sm font-semibold border border-emerald-400/60 text-emerald-200 disabled:opacity-40">
                                                {busy === r.state_name ? t('rates.acknowledging') : t('rates.acknowledge')}
                                            </button>
                                        )}
                                        {canSet && (
                                            <>
                                                <label className="sr-only" htmlFor={`rate-${r.state_name}`}>{t('rates.newRate', { state: label(r) })}</label>
                                                <input id={`rate-${r.state_name}`} className="app-input w-28 text-end" dir="ltr" inputMode="decimal"
                                                    placeholder={isSet ? fmt(Number(r.sdg_per_usd)) : 'SDG'}
                                                    value={value} onChange={e => setEdits(x => ({ ...x, [r.state_name]: e.target.value }))} />
                                                <button type="button" onClick={() => save(r)} disabled={!value.trim() || busy === r.state_name}
                                                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-brand-orange text-[#152238] disabled:opacity-40">
                                                    {busy === r.state_name ? t('rates.saving') : t('rates.save')}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </AppShell>
    );
}
