// Superadmin: national projects (Direct Fund first). Each project is one working group:
// the states it's open to, whether it takes new F1 requests, and its members by function.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AppShell from '../components/layout/AppShell';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { Plus, Trash2, ChevronDown, Users, MapPin, FileText } from 'lucide-react';

type Member = { user_id: string; name: string | null; email: string | null; function: string | null; is_lead: boolean; status: string | null };
type FundProject = {
    id: string; name_en: string; name_ar: string; is_active: boolean; accepts_f1: boolean;
    states: string[]; members: Member[]; f1_count: number;
};
type Person = { user_id: string; name: string | null; email: string | null };
type StateOpt = { state_name: string; state_name_ar: string | null };
type Draft = { id: string | null; name_en: string; name_ar: string; accepts_f1: boolean; states: string[] };

const FUNCTIONS = ['program', 'finance', 'reporting', 'comms'] as const;
const chip = 'px-2.5 py-1 rounded-full text-xs font-semibold border transition';

export default function ProjectsAdminPage() {
    const { t, i18n } = useTranslation('app');
    const isAr = i18n.language?.startsWith('ar');
    const { ready, token, role } = useRequireAuth();
    const [projects, setProjects] = useState<FundProject[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [stateOpts, setStateOpts] = useState<StateOpt[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [newMember, setNewMember] = useState<{ user_id: string; function: string }>({ user_id: '', function: 'program' });

    const call = useCallback(async (body?: object) => {
        const res = await fetch('/api/fund-projects/admin', {
            method: body ? 'POST' : 'GET',
            headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.code || 'server_error');
        return data;
    }, [token]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await call();
            setProjects(data.projects || []);
            setPeople(data.people || []);
            setStateOpts(data.states || []);
        } catch (e: any) {
            setMessage({ kind: 'error', text: errText(e.message) });
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [call]);

    useEffect(() => { if (ready && role === 'superadmin') load(); }, [ready, role, load]);

    const errText = (code: string) => t(`fp.errors.${code}`, { defaultValue: t('fp.errors.server_error') });
    const stateLabel = (s: string) => {
        const o = stateOpts.find(x => x.state_name === s);
        return (isAr ? o?.state_name_ar : null) || s;
    };
    const name = (p: { name_en: string; name_ar: string }) => (isAr ? p.name_ar || p.name_en : p.name_en || p.name_ar);
    const sortedStates = useMemo(
        () => [...stateOpts].sort((a, b) => stateLabel(a.state_name).localeCompare(stateLabel(b.state_name))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [stateOpts, isAr]
    );

    const startEdit = (p: FundProject | null) => {
        setMessage(null);
        setNewMember({ user_id: '', function: 'program' });
        if (!p) {
            setOpen('new');
            setDraft({ id: null, name_en: '', name_ar: '', accepts_f1: true, states: [] });
            return;
        }
        if (open === p.id) { setOpen(null); setDraft(null); return; }
        setOpen(p.id);
        setDraft({ id: p.id, name_en: p.name_en, name_ar: p.name_ar, accepts_f1: p.accepts_f1, states: [...p.states] });
    };

    const run = async (body: object, okText: string) => {
        setBusy(true);
        setMessage(null);
        try {
            const data = await call(body);
            await load();
            setMessage({ kind: 'ok', text: okText });
            return data;
        } catch (e: any) {
            setMessage({ kind: 'error', text: errText(e.message) });
            return null;
        } finally {
            setBusy(false);
        }
    };

    const save = async () => {
        if (!draft) return;
        if (!draft.name_ar.trim() || !draft.name_en.trim()) {
            setMessage({ kind: 'error', text: t('fp.errors.name_required') });
            return;
        }
        const data = await run({ action: 'save', ...draft, is_active: true }, t('fp.saved'));
        if (data?.id) { setOpen(data.id); setDraft(d => (d ? { ...d, id: data.id } : d)); }
    };

    if (!ready) {
        return <AppShell title={t('fp.title')}><p className="text-[#a8b6cc] text-sm">{t('common.loading')}</p></AppShell>;
    }
    if (role !== 'superadmin') {
        return <AppShell title={t('fp.title')}><div className="app-panel p-4 text-sm text-[#a8b6cc]">{t('fp.onlySuperadmin')}</div></AppShell>;
    }

    const editor = (p: FundProject | null) => draft && (
        <div className="border-t border-white/10 p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                    <span className="block text-xs font-semibold text-[#a8b6cc] mb-1">{t('fp.nameAr')}</span>
                    <input className="app-input" dir="rtl" value={draft.name_ar} onChange={e => setDraft({ ...draft, name_ar: e.target.value })} placeholder="الدعم المباشر" />
                </label>
                <label className="block">
                    <span className="block text-xs font-semibold text-[#a8b6cc] mb-1">{t('fp.nameEn')}</span>
                    <input className="app-input" dir="ltr" value={draft.name_en} onChange={e => setDraft({ ...draft, name_en: e.target.value })} placeholder="Direct Fund" />
                </label>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[#F9A778]" checked={draft.accepts_f1} onChange={e => setDraft({ ...draft, accepts_f1: e.target.checked })} />
                <span>
                    <span className="block text-sm font-semibold text-white">{t('fp.acceptsF1')}</span>
                    <span className="block text-xs text-[#8a97ab]">{t('fp.acceptsF1Hint')}</span>
                </span>
            </label>

            <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-semibold text-white">{t('fp.states')} <span className="text-[#8a97ab] font-normal">({draft.states.length}/{stateOpts.length})</span></span>
                    <span className="flex gap-2">
                        <button type="button" className="text-xs font-semibold text-brand-orange hover:underline" onClick={() => setDraft({ ...draft, states: stateOpts.map(s => s.state_name) })}>{t('fp.allStates')}</button>
                        <button type="button" className="text-xs font-semibold text-[#a8b6cc] hover:underline" onClick={() => setDraft({ ...draft, states: [] })}>{t('fp.noStates')}</button>
                    </span>
                </div>
                <p className="text-xs text-[#8a97ab] mb-2">{t('fp.statesHint')}</p>
                <div className="flex flex-wrap gap-2">
                    {sortedStates.map(s => {
                        const on = draft.states.includes(s.state_name);
                        return (
                            <button key={s.state_name} type="button" aria-pressed={on}
                                onClick={() => setDraft({ ...draft, states: on ? draft.states.filter(x => x !== s.state_name) : [...draft.states, s.state_name] })}
                                className={`${chip} ${on ? 'bg-brand-orange text-[#152238] border-brand-orange' : 'bg-[#152238] text-[#a8b6cc] border-white/15 hover:border-white/30'}`}>
                                {stateLabel(s.state_name)}
                            </button>
                        );
                    })}
                </div>
            </div>

            <button type="button" disabled={busy} onClick={save} className="rounded-xl bg-brand-orange text-[#152238] px-5 py-2.5 text-sm font-semibold hover:bg-[#ffb88a] disabled:opacity-60">
                {busy ? t('common.loading') : draft.id ? t('fp.save') : t('fp.create')}
            </button>

            {p && (
                <div className="border-t border-white/10 pt-4">
                    <h3 className="text-sm font-bold text-white mb-1">{t('fp.members')}</h3>
                    <p className="text-xs text-[#8a97ab] mb-3">{t('fp.membersHint')}</p>
                    {p.members.length === 0 ? (
                        <p className="text-sm text-[#a8b6cc]">{t('fp.noMembers')}</p>
                    ) : (
                        <ul className="space-y-2">
                            {p.members.map(m => (
                                <li key={m.user_id} className="rounded-xl bg-[#152238] border border-white/10 p-3 flex flex-wrap items-center gap-2">
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-semibold text-white truncate">{m.name || m.email || '—'}</span>
                                        <span className="block text-xs text-[#8a97ab] truncate" dir="ltr">{m.email}</span>
                                    </span>
                                    <select className="app-input !w-auto !py-1.5 text-xs" value={m.function || ''} disabled={busy} aria-label={t('fp.function')}
                                        onChange={e => run({ action: 'member_set', group_id: p.id, user_id: m.user_id, function: e.target.value, is_lead: m.is_lead }, t('fp.saved'))}>
                                        {!m.function && <option value="">{t('fp.chooseFunction')}</option>}
                                        {FUNCTIONS.map(f => <option key={f} value={f}>{t(`fp.functions.${f}`)}</option>)}
                                    </select>
                                    <label className="flex items-center gap-1.5 text-xs text-[#a8b6cc]">
                                        <input type="checkbox" className="h-3.5 w-3.5 accent-[#F9A778]" checked={m.is_lead} disabled={busy || !m.function}
                                            onChange={e => run({ action: 'member_set', group_id: p.id, user_id: m.user_id, function: m.function, is_lead: e.target.checked }, t('fp.saved'))} />
                                        {t('fp.lead')}
                                    </label>
                                    <button type="button" disabled={busy} title={t('fp.remove')} aria-label={t('fp.remove')}
                                        onClick={() => { if (window.confirm(t('fp.removeConfirm', { name: m.name || m.email || '' }))) run({ action: 'member_remove', group_id: p.id, user_id: m.user_id }, t('fp.removed')); }}
                                        className="p-1.5 rounded-lg text-[#a8b6cc] hover:text-red-300 hover:bg-red-500/10">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {(() => {
                        const candidates = people.filter(x => !p.members.some(m => m.user_id === x.user_id));
                        return candidates.length === 0 ? (
                            <p className="text-xs text-[#8a97ab] mt-3">{t('fp.noPeople')}</p>
                        ) : (
                            <div className="flex flex-wrap items-end gap-2 mt-3">
                                <label className="flex-1 min-w-[12rem]">
                                    <span className="block text-xs font-semibold text-[#a8b6cc] mb-1">{t('fp.addMember')}</span>
                                    <select className="app-input !py-2 text-sm" value={newMember.user_id} onChange={e => setNewMember({ ...newMember, user_id: e.target.value })}>
                                        <option value="">{t('x.select2')}</option>
                                        {candidates.map(x => <option key={x.user_id} value={x.user_id}>{x.name || x.email}{x.name && x.email ? ` · ${x.email}` : ''}</option>)}
                                    </select>
                                </label>
                                <label>
                                    <span className="block text-xs font-semibold text-[#a8b6cc] mb-1">{t('fp.function')}</span>
                                    <select className="app-input !py-2 text-sm" value={newMember.function} onChange={e => setNewMember({ ...newMember, function: e.target.value })}>
                                        {FUNCTIONS.map(f => <option key={f} value={f}>{t(`fp.functions.${f}`)}</option>)}
                                    </select>
                                </label>
                                <button type="button" disabled={busy || !newMember.user_id}
                                    onClick={async () => { const ok = await run({ action: 'member_set', group_id: p.id, user_id: newMember.user_id, function: newMember.function, is_lead: false }, t('fp.added')); if (ok) setNewMember({ user_id: '', function: 'program' }); }}
                                    className="rounded-xl bg-brand-orange text-[#152238] px-4 py-2 text-sm font-semibold disabled:opacity-50 flex items-center gap-1">
                                    <Plus className="h-4 w-4" />{t('fp.add')}
                                </button>
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );

    return (
        <AppShell title={t('fp.title')}>
            <div className="space-y-4 max-w-3xl">
                <p className="text-sm text-[#a8b6cc]">{t('fp.intro')}</p>

                {message && (
                    <div role="status" className={`rounded-xl border px-3 py-2 text-sm ${message.kind === 'ok' ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200' : 'bg-red-500/10 border-red-400/30 text-red-200'}`}>
                        {message.text}
                    </div>
                )}

                {loading ? (
                    <p className="text-[#a8b6cc] text-sm">{t('common.loading')}</p>
                ) : (
                    <ul className="space-y-3">
                        {projects.map(p => (
                            <li key={p.id} className={`app-panel overflow-hidden ${p.is_active ? '' : 'opacity-60'}`}>
                                <button type="button" aria-expanded={open === p.id} onClick={() => startEdit(p)}
                                    className="w-full text-start p-4 flex items-center gap-3 hover:bg-white/5 transition">
                                    <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-center gap-2">
                                            <span className="font-bold text-white">{name(p)}</span>
                                            <span className={`${chip} ${p.accepts_f1 ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30' : 'bg-white/5 text-[#a8b6cc] border-white/15'}`}>
                                                {p.accepts_f1 ? t('fp.open') : t('fp.closed')}
                                            </span>
                                        </span>
                                        <span className="block text-xs text-[#8a97ab] mt-1"><bdi>{isAr ? p.name_en : p.name_ar}</bdi></span>
                                        <span className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-[#a8b6cc]">
                                            <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{t('fp.statesCount', { count: p.states.length })}</span>
                                            <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{t('fp.membersCount', { count: p.members.length })}</span>
                                            <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{t('fp.f1Count', { count: p.f1_count })}</span>
                                        </span>
                                    </span>
                                    <ChevronDown className={`h-5 w-5 shrink-0 text-[#a8b6cc] transition-transform ${open === p.id ? 'rotate-180' : ''}`} />
                                </button>
                                {open === p.id && editor(p)}
                            </li>
                        ))}
                        <li className="app-panel overflow-hidden">
                            {open === 'new' ? (
                                <>
                                    <div className="p-4 font-bold text-white">{t('fp.newProject')}</div>
                                    {editor(null)}
                                </>
                            ) : (
                                <button type="button" onClick={() => startEdit(null)} className="w-full text-start p-4 flex items-center gap-2 font-semibold text-brand-orange hover:bg-white/5">
                                    <Plus className="h-5 w-5" />{t('fp.newProject')}
                                </button>
                            )}
                        </li>
                    </ul>
                )}
                <p className="text-xs text-[#8a97ab]">{t('fp.accountsHint')}</p>
            </div>
        </AppShell>
    );
}
