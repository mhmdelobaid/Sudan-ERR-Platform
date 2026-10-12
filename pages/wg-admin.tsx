// pages/wg-admin.tsx
// Admins: create LCC working groups, add their members, and assign groups to projects
// (one group per project is the program lead). The database checks the admin role and state scope.
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button';
import { newSupabase } from '../services/newSupabaseClient';

type LccStatus = 'no_working_group' | 'waiting' | 'approved' | 'returned';
interface Member { user_id: string; display_name: string | null; email: string | null; is_lead: boolean; role: string; status: string }
interface Group { id: string; name_en: string; name_ar: string | null; is_active: boolean; projects: number; members: Member[] }
interface ProjectRow {
    id: string; project_name: string | null; state: string | null; locality: string | null; status: string;
    room_name: string | null; room_name_ar: string | null; submitted_at: string | null; lcc_status: LccStatus;
    groups: { id: string; name_en: string; name_ar: string | null; is_program_lead: boolean }[];
}

const STATUSES = ['screened', 'pending', 'feedback', 'approved', 'active', 'completed', 'rejected'];
const inputCls = 'w-full rounded-lg border border-gray-300 p-2 text-sm outline-none focus:border-brand-blue';

async function authHeaders(): Promise<Record<string, string> | null> {
    const { data: { session } } = await newSupabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <section className="bg-white rounded-2xl shadow-md p-4 space-y-3">{children}</section>
);

const WgAdmin: React.FC = () => {
    const router = useRouter();
    const { t, i18n } = useTranslation('wgAdmin');
    const isAr = i18n.language === 'ar';
    const errorText = (code?: string) => t(`errors.${code || 'server_error'}`, { defaultValue: t('errors.server_error') });
    const groupName = (g: { name_en: string; name_ar: string | null }) => (isAr ? g.name_ar || g.name_en : g.name_en);
    const roomName = (r: { room_name: string | null; room_name_ar: string | null }) =>
        (isAr ? r.room_name_ar || r.room_name : r.room_name || r.room_name_ar) || '—';

    const [auth, setAuth] = useState<'loading' | 'ok' | 'denied'>('loading');
    const [tab, setTab] = useState<'projects' | 'groups'>('projects');
    const [groups, setGroups] = useState<Group[]>([]);
    const [projects, setProjects] = useState<ProjectRow[]>([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('screened');
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    // assignment editor
    const [editing, setEditing] = useState<string | null>(null);
    const [picked, setPicked] = useState<string[]>([]);
    const [lead, setLead] = useState<string | null>(null);
    // group forms
    const [newAr, setNewAr] = useState('');
    const [newEn, setNewEn] = useState('');
    const [memberEmail, setMemberEmail] = useState<Record<string, string>>({});
    const [memberLead, setMemberLead] = useState<Record<string, boolean>>({});

    useEffect(() => {
        (async () => {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch('/api/validate-session', { headers });
            if (!res.ok) { router.push('/login'); return; }
            const data = await res.json();
            setAuth(data.success && ['admin', 'superadmin'].includes(data.user?.role) ? 'ok' : 'denied');
        })().catch(() => router.push('/login'));
    }, [router]);

    const call = useCallback(async (url: string, init?: RequestInit) => {
        const headers = await authHeaders();
        if (!headers) { router.push('/login'); throw new Error('unauthorized'); }
        const res = await fetch(url, { ...init, headers });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.code);
        return data;
    }, [router]);

    const loadGroups = useCallback(async () => {
        const data = await call('/api/wg-admin?view=groups');
        setGroups(data.groups);
    }, [call]);

    const loadProjects = useCallback(async () => {
        const q = new URLSearchParams({ view: 'projects', search, status: statusFilter });
        const data = await call(`/api/wg-admin?${q.toString()}`);
        setProjects(data.projects);
    }, [call, search, statusFilter]);

    const reload = useCallback(async () => {
        setLoading(true);
        try { await Promise.all([loadGroups(), loadProjects()]); }
        catch (e: any) { console.error('WG admin load failed:', e); setMessage({ kind: 'error', text: errorText(e?.message) }); }
        finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadGroups, loadProjects]);

    // Reload when the search or status filter changes (debounced so typing doesn't fire a request per key)
    useEffect(() => {
        if (auth !== 'ok') return;
        const h = setTimeout(reload, 300);
        return () => clearTimeout(h);
    }, [auth, reload]);

    const post = async (body: object, okText?: string) => {
        setBusy(true); setMessage(null);
        try {
            await call('/api/wg-admin', { method: 'POST', body: JSON.stringify(body) });
            if (okText) setMessage({ kind: 'ok', text: okText });
            await reload();
            return true;
        } catch (e: any) {
            setMessage({ kind: 'error', text: errorText(e?.message) });
            return false;
        } finally {
            setBusy(false);
        }
    };

    const startEdit = (p: ProjectRow) => {
        setEditing(p.id);
        setPicked(p.groups.map(g => g.id));
        setLead(p.groups.find(g => g.is_program_lead)?.id || null);
        setMessage(null);
    };
    const togglePick = (id: string) => {
        setPicked(prev => {
            const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
            if (!next.includes(lead || '')) setLead(next[0] || null);
            return next;
        });
    };
    const saveAssignment = async () => {
        if (!editing) return;
        const ok = await post({ action: 'set_project_groups', project_id: editing, group_ids: picked, program_lead: picked.length ? lead : null }, t('projects.saved'));
        if (ok) setEditing(null);
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

                <div className="flex gap-2">
                    {(['projects', 'groups'] as const).map(k => (
                        <button key={k} onClick={() => setTab(k)}
                            className={`flex-1 rounded-xl py-2 text-sm font-semibold border transition ${tab === k ? 'bg-primaryGreen text-white border-primaryGreen' : 'bg-white text-gray-700 border-gray-300'}`}>
                            {t(`tabs.${k}`)}
                        </button>
                    ))}
                </div>

                {/* ---------- Assign projects ---------- */}
                {tab === 'projects' && (
                    <>
                        <Card>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('projects.search')}
                                    className={`${inputCls} sm:col-span-2`} aria-label={t('projects.search')} />
                                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls} aria-label={t('projects.status')}>
                                    <option value="">{t('projects.allStatuses')}</option>
                                    {STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                                </select>
                            </div>
                        </Card>
                        {loading ? (
                            <Card><p className="text-gray-600 mb-0">{t('loading')}</p></Card>
                        ) : projects.length === 0 ? (
                            <Card><p className="text-gray-600 mb-0">{t('projects.none')}</p></Card>
                        ) : (
                            <ul className="space-y-3">
                                {projects.map(p => (
                                    <li key={p.id}>
                                        <Card>
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="font-bold text-gray-900 mb-0">{p.project_name || '—'}</p>
                                                    <p className="text-sm text-gray-600 mb-0">{roomName(p)} · {p.locality || '—'} · {p.state || '—'}</p>
                                                </div>
                                                <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-800">{t(`status.${p.status}`, { defaultValue: p.status })}</span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                                <span className="text-gray-500">{t('projects.groups')}:</span>
                                                {p.groups.length === 0 ? <span className="text-gray-400">{t('projects.noGroups')}</span> : p.groups.map(g => (
                                                    <span key={g.id} className={`rounded-full px-2 py-0.5 font-semibold ${g.is_program_lead ? 'bg-brand-blue text-white' : 'bg-gray-100 text-gray-700'}`}>
                                                        {groupName(g)}{g.is_program_lead ? ` · ${t('projects.programLead')}` : ''}
                                                    </span>
                                                ))}
                                                <span className="text-gray-400">· {t(`lccStatus.${p.lcc_status}`)}</span>
                                            </div>

                                            {editing === p.id ? (
                                                <div className="border-t border-gray-100 pt-3 space-y-2">
                                                    {groups.length === 0 ? <p className="text-sm text-gray-600 mb-0">{t('projects.noGroupsYet')}</p> : (
                                                        <>
                                                            <p className="text-xs text-gray-500 mb-0">{t('projects.pickGroups')}</p>
                                                            <ul className="space-y-1">
                                                                {groups.map(g => (
                                                                    <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                                                                        <label className="flex items-center gap-2">
                                                                            <input type="checkbox" checked={picked.includes(g.id)} onChange={() => togglePick(g.id)} />
                                                                            {groupName(g)}
                                                                        </label>
                                                                        {picked.includes(g.id) && (
                                                                            <label className="flex items-center gap-1 text-xs text-gray-700">
                                                                                <input type="radio" name={`lead-${p.id}`} checked={lead === g.id} onChange={() => setLead(g.id)} />
                                                                                {t('projects.programLead')}
                                                                            </label>
                                                                        )}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </>
                                                    )}
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <Button text={t('projects.save')} onClick={saveAssignment} disabled={busy || (picked.length > 0 && !lead)} className="w-full" />
                                                        <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-gray-300 bg-white text-gray-700 py-2 m-1">{t('projects.cancel')}</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <Button text={t('projects.edit')} onClick={() => startEdit(p)} className="w-full" />
                                            )}
                                        </Card>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}

                {/* ---------- Groups and members ---------- */}
                {tab === 'groups' && (
                    <>
                        <Card>
                            <h2 className="font-bold mb-0">{t('groups.create')}</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <input value={newAr} onChange={e => setNewAr(e.target.value)} placeholder={t('groups.nameAr')} className={inputCls} dir="rtl" aria-label={t('groups.nameAr')} />
                                <input value={newEn} onChange={e => setNewEn(e.target.value)} placeholder={t('groups.nameEn')} className={inputCls} dir="ltr" aria-label={t('groups.nameEn')} />
                            </div>
                            <Button text={t('groups.create')} disabled={busy || (!newAr.trim() && !newEn.trim())} className="w-full"
                                onClick={async () => { if (await post({ action: 'create_group', name_ar: newAr, name_en: newEn }, t('groups.created'))) { setNewAr(''); setNewEn(''); } }} />
                        </Card>

                        {groups.length === 0 ? <Card><p className="text-gray-600 mb-0">{t('groups.none')}</p></Card> : groups.map(g => (
                            <Card key={g.id}>
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <h3 className="font-bold mb-0">{groupName(g)}</h3>
                                        <p className="text-xs text-gray-500 mb-0">{isAr ? g.name_en : g.name_ar || ''}</p>
                                    </div>
                                    <span className="text-xs text-gray-600"><bdi>{g.projects}</bdi> {t('groups.projects')}</span>
                                </div>
                                <div>
                                    <span className="block text-xs text-gray-500 mb-1">{t('groups.members')}</span>
                                    {g.members.length === 0 ? <p className="text-sm text-gray-400 mb-0">{t('groups.noMembers')}</p> : (
                                        <ul className="space-y-1">
                                            {g.members.map(m => (
                                                <li key={m.user_id} className="flex items-center justify-between gap-2 text-sm">
                                                    <span className="min-w-0">
                                                        <strong>{m.display_name || '—'}</strong>{' '}
                                                        <span className="text-gray-500 text-xs" dir="ltr">{m.email}</span>
                                                        {m.is_lead && <span className="ms-2 rounded-full px-2 py-0.5 text-xs bg-brand-blue text-white">{t('groups.lead')}</span>}
                                                    </span>
                                                    <button type="button" disabled={busy} onClick={() => post({ action: 'remove_member', group_id: g.id, user_id: m.user_id })}
                                                        className="text-xs text-red-700 hover:underline disabled:opacity-50">{t('groups.remove')}</button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                <div className="border-t border-gray-100 pt-3 space-y-2">
                                    <span className="block text-xs text-gray-500">{t('groups.addMember')} — {t('groups.roleNote')}</span>
                                    <input type="email" dir="ltr" value={memberEmail[g.id] || ''} onChange={e => setMemberEmail(prev => ({ ...prev, [g.id]: e.target.value }))}
                                        placeholder={t('groups.email')} className={inputCls} aria-label={t('groups.email')} />
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={!!memberLead[g.id]} onChange={e => setMemberLead(prev => ({ ...prev, [g.id]: e.target.checked }))} />
                                        {t('groups.isLead')}
                                    </label>
                                    <Button text={t('groups.add')} disabled={busy || !(memberEmail[g.id] || '').trim()} className="w-full"
                                        onClick={async () => {
                                            if (await post({ action: 'add_member', group_id: g.id, email: memberEmail[g.id], is_lead: !!memberLead[g.id] }, t('groups.added'))) {
                                                setMemberEmail(prev => ({ ...prev, [g.id]: '' }));
                                                setMemberLead(prev => ({ ...prev, [g.id]: false }));
                                            }
                                        }} />
                                </div>
                            </Card>
                        ))}
                    </>
                )}

                <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
            </div>
        </div>
    );
};

export default WgAdmin;
