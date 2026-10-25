// User management (superadmin only): every user with role, access scope and status; change role, room,
// status, name and visible states; import lists of people; activate them and send password links.
// The database refuses anyone who isn't a superadmin and logs every change.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button';
import { newSupabase } from '../services/newSupabaseClient';
import ImportPanel from '../components/userManagement/ImportPanel';

type Status = 'pending' | 'active' | 'suspended' | 'deleted';
interface UserRow {
    id: string; display_name: string | null; email: string | null; role: string; status: Status;
    err_id: string | null; room_name: string | null; room_name_ar: string | null; room_type: string | null; err_code: string | null;
    locality: string | null; locality_ar: string | null; state: string | null; state_ar: string | null;
    can_see_all_states: boolean; visible_states: string[]; created_at: string | null; last_sign_in_at: string | null; is_me: boolean;
    position?: string | null; imported_at?: string | null; last_link_at?: string | null; last_link_method?: 'email' | 'copy' | null; link_count?: number;
}
interface Room {
    id: string; name: string | null; name_ar: string | null; type: string | null; err_code: string | null; status: string | null;
    state: string | null; state_ar: string | null; locality: string | null; locality_ar: string | null;
}
interface StateOpt { name: string; name_ar: string | null }

const ROLES = ['base_err', 'locality_err', 'state_err', 'state_rep', 'lcc_wg', 'support', 'admin', 'superadmin', 'partner'];
const STATUSES: Status[] = ['active', 'pending', 'suspended'];
// The room a role needs (null = no room, 'any' = any room)
const ROOM_FOR: Record<string, string | null> = {
    base_err: 'base', locality_err: 'locality', state_err: 'state', state_rep: 'any',
    lcc_wg: null, support: null, admin: null, superadmin: null, partner: null,
};
const SCOPED_STATES = ['admin', 'support'];   // roles whose access is a list of states
const STATUS_CHIP: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-800', pending: 'bg-amber-100 text-amber-900',
    suspended: 'bg-red-100 text-red-800', deleted: 'bg-gray-200 text-gray-700',
};

async function authHeaders(): Promise<Record<string, string> | null> {
    const { data: { session } } = await newSupabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

const Tile: React.FC<{ label: string; value: number; hint: string; active: boolean; onClick: () => void }> = ({ label, value, hint, active, onClick }) => (
    <button type="button" onClick={onClick}
        className={`text-start bg-white rounded-xl border p-3 transition ${active ? 'border-brand-blue ring-2 ring-brand-blue/30' : 'border-gray-200 hover:border-gray-300'}`}>
        <span className="block text-xs text-gray-600">{label}</span>
        <span className="block text-2xl font-bold text-gray-900 mt-1"><bdi>{value.toLocaleString('en-US')}</bdi></span>
        <span className="block text-xs text-gray-500">{hint}</span>
    </button>
);

const UserManagement: React.FC = () => {
    const router = useRouter();
    const { t, i18n } = useTranslation('userManagement');
    const isAr = i18n.language === 'ar';
    const fmtDate = (d: string | null | undefined) =>
        d ? new Date(d).toLocaleDateString(isAr ? 'ar-SD' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const ar = (en: string | null | undefined, arv: string | null | undefined) => (isAr ? arv || en : en || arv) || '';
    const errorText = (code?: string) => t(`errors.${code || 'server_error'}`, { defaultValue: t('errors.server_error') });

    const [auth, setAuth] = useState<'loading' | 'ok' | 'denied'>('loading');
    const [users, setUsers] = useState<UserRow[]>([]);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [states, setStates] = useState<StateOpt[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [stateFilter, setStateFilter] = useState('');
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState<{ display_name: string; role: string; status: Status; err_id: string; can_see_all_states: boolean; visible_states: string[] } | null>(null);
    const [roomSearch, setRoomSearch] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [showImport, setShowImport] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
    const [copyBox, setCopyBox] = useState<{ name: string; link: string } | null>(null);
    const [copied, setCopied] = useState('');

    useEffect(() => {
        (async () => {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch('/api/validate-session', { headers });
            if (!res.ok) { router.push('/login'); return; }
            const data = await res.json();
            setAuth(data.success && data.user?.role === 'superadmin' ? 'ok' : 'denied');
        })().catch(() => router.push('/login'));
    }, [router]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch('/api/user-management', { headers });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.code);
            setUsers(data.users); setRooms(data.rooms); setStates(data.states);
        } catch (e: any) {
            setMessage({ kind: 'error', text: errorText(e?.message) });
        } finally {
            setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);
    useEffect(() => { if (auth === 'ok') load(); }, [auth, load]);

    // Ask the server for a password link: 'email' sends it, 'copy' returns it. Returns the error code, or '' when it worked.
    const requestLink = async (user: UserRow, method: 'email' | 'copy'): Promise<{ code: string; link?: string }> => {
        try {
            const headers = await authHeaders();
            if (!headers) return { code: 'unauthorized' };
            const res = await fetch('/api/user-password-link', { method: 'POST', headers, body: JSON.stringify({ user_id: user.id, method }) });
            const data = await res.json();
            if (!res.ok || !data.success) return { code: data.code || 'server_error' };
            return { code: '', link: data.link };
        } catch {
            return { code: 'server_error' };
        }
    };

    const sendLink = async (user: UserRow, method: 'email' | 'copy') => {
        setBusy(user.id); setMessage(null); setCopyBox(null); setCopied('');
        const { code, link } = await requestLink(user, method);
        if (code) setMessage({ kind: 'error', text: errorText(code) });
        else if (method === 'copy' && link) setCopyBox({ name: user.display_name || user.email || '', link });
        else setMessage({ kind: 'ok', text: t('link.emailed', { email: user.email }) });
        await load();
        setBusy(null);
    };

    const save = async (user: UserRow, changes: Record<string, unknown>, okText: string) => {
        setBusy(user.id); setMessage(null); setCopyBox(null);
        try {
            const headers = await authHeaders();
            if (!headers) { router.push('/login'); return; }
            const res = await fetch('/api/user-management', { method: 'POST', headers, body: JSON.stringify({ user_id: user.id, changes }) });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.code);
            let text = okText;
            let kind: 'ok' | 'error' = 'ok';
            // First activation of someone who never signed in: email them the link to create their password.
            if (changes.status === 'active' && user.status !== 'active' && !user.last_sign_in_at) {
                const { code } = await requestLink(user, 'email');
                if (code) { kind = 'error'; text = t('link.activatedNoEmail', { reason: errorText(code) }); }
                else text = t('link.activatedAndEmailed', { email: user.email });
            }
            await load();
            setEditing(null); setDraft(null);
            setMessage({ kind, text });
        } catch (e: any) {
            setMessage({ kind: 'error', text: errorText(e?.message) });
        } finally {
            setBusy(null);
        }
    };

    // Activate the selected pending people one by one and email each their link. If the email limit is
    // reached, keep activating but stop emailing; the admin copies those links or sends them later.
    const activateSelected = async () => {
        const list = users.filter(u => selected.has(u.id) && u.status !== 'active' && !u.is_me);
        if (list.length === 0) return;
        setMessage(null); setCopyBox(null);
        setBulk({ done: 0, total: list.length });
        let activated = 0, emailed = 0, emailStop = '';
        const failed: string[] = [];
        for (let i = 0; i < list.length; i++) {
            const u = list[i];
            try {
                const headers = await authHeaders();
                if (!headers) { router.push('/login'); return; }
                const res = await fetch('/api/user-management', { method: 'POST', headers, body: JSON.stringify({ user_id: u.id, changes: { status: 'active' } }) });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.code);
                activated++;
                if (!u.last_sign_in_at && !emailStop) {
                    const { code } = await requestLink(u, 'email');
                    if (!code) emailed++;
                    else if (code === 'email_rate_limit') emailStop = code;
                }
            } catch {
                failed.push(u.display_name || u.email || u.id);
            }
            setBulk({ done: i + 1, total: list.length });
        }
        setBulk(null);
        setSelected(new Set());
        await load();
        const parts = [t('bulk.result', { activated, emailed })];
        if (emailStop) parts.push(t('bulk.emailLimit'));
        if (failed.length) parts.push(t('bulk.failed', { names: failed.join(isAr ? '، ' : ', ') }));
        setMessage({ kind: emailStop || failed.length ? 'error' : 'ok', text: parts.join(' ') });
    };

    const copyText = async (value: string, which: string) => {
        try { await navigator.clipboard.writeText(value); setCopied(which); }
        catch { setCopied('manual'); }
    };

    const openEdit = (u: UserRow) => {
        setEditing(u.id); setRoomSearch(''); setMessage(null);
        setDraft({ display_name: u.display_name || '', role: u.role, status: u.status === 'deleted' ? 'suspended' : u.status, err_id: u.err_id || '',
                   can_see_all_states: u.can_see_all_states, visible_states: u.visible_states || [] });
    };
    const saveEdit = (u: UserRow) => {
        if (!draft) return;
        const changes: Record<string, unknown> = {};
        if ((draft.display_name || '') !== (u.display_name || '')) changes.display_name = draft.display_name;
        if (draft.role !== u.role && !u.is_me) changes.role = draft.role;
        if (draft.status !== u.status && !u.is_me) changes.status = draft.status;
        const needsRoom = ROOM_FOR[draft.role] !== null;
        const room = needsRoom ? draft.err_id : '';
        if (room !== (u.err_id || '')) changes.err_id = room;
        if (SCOPED_STATES.includes(draft.role)) {
            if (draft.can_see_all_states !== u.can_see_all_states) changes.can_see_all_states = draft.can_see_all_states;
            const a = [...draft.visible_states].sort().join('|'), b = [...(u.visible_states || [])].sort().join('|');
            if (a !== b) changes.visible_states = draft.visible_states;
        }
        if (Object.keys(changes).length === 0) { setEditing(null); setDraft(null); return; }
        save(u, changes, t('saved'));
    };

    // Counts and filtering
    const counts = useMemo(() => ({
        all: users.length,
        active: users.filter(u => u.status === 'active').length,
        pending: users.filter(u => u.status === 'pending').length,
        suspended: users.filter(u => u.status === 'suspended').length,
        noSignIn: users.filter(u => u.status === 'active' && !u.last_sign_in_at).length,
    }), [users]);
    const roleCounts = useMemo(() => ROLES.map(r => ({ role: r, n: users.filter(u => u.role === r).length })).filter(x => x.n > 0), [users]);
    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        return users.filter(u =>
            (!roleFilter || u.role === roleFilter) &&
            (!statusFilter || (statusFilter === 'nosignin' ? u.status === 'active' && !u.last_sign_in_at : u.status === statusFilter)) &&
            (!stateFilter || u.state === stateFilter || (SCOPED_STATES.includes(u.role) && (u.can_see_all_states || u.visible_states.includes(stateFilter)))) &&
            (!q || [u.display_name, u.email, u.room_name, u.room_name_ar, u.err_code, u.locality, u.locality_ar, u.state, u.state_ar]
                .some(v => (v || '').toLowerCase().includes(q))));
    }, [users, search, roleFilter, statusFilter, stateFilter]);

    const scopeText = (u: UserRow) => {
        if (u.role === 'superadmin' || u.role === 'lcc_wg') return t('scope.allStates');
        if (u.role === 'partner') return t('scope.portalOnly');
        if (SCOPED_STATES.includes(u.role)) {
            if (u.can_see_all_states) return t('scope.allStates');
            return u.visible_states.length ? u.visible_states.map(s => ar(s, states.find(x => x.name === s)?.name_ar)).join(isAr ? '، ' : ', ') : t('scope.none');
        }
        if (!u.err_id) return t('scope.noRoom');
        const place = [ar(u.locality, u.locality_ar), ar(u.state, u.state_ar)].filter(Boolean).join(' · ');
        return `${ar(u.room_name, u.room_name_ar)}${place ? ` — ${place}` : ''}`;
    };
    // Where this person is with their password: signed in, link sent, or nothing yet.
    const linkStatus = (u: UserRow) => {
        if (u.last_sign_in_at || u.status !== 'active') return null;
        if (u.last_link_at) return t(u.last_link_method === 'copy' ? 'link.copiedOn' : 'link.emailedOn', { date: fmtDate(u.last_link_at), count: u.link_count || 1 });
        return t('link.none');
    };
    const selectable = (u: UserRow) => u.status !== 'active' && !u.is_me;
    const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const roomsFor = (role: string) => {
        const need = ROOM_FOR[role];
        const q = roomSearch.trim().toLowerCase();
        return rooms
            .filter(r => need === 'any' || r.type === need)
            .filter(r => !q || [r.name, r.name_ar, r.err_code, r.locality, r.locality_ar, r.state, r.state_ar].some(v => (v || '').toLowerCase().includes(q)))
            .slice(0, 200);
    };

    const langSwitch = (
        <div className="flex justify-end text-sm">
            <button onClick={() => i18n.changeLanguage('en')} className="mx-2 text-blue-500 hover:underline">English</button>
            <button onClick={() => i18n.changeLanguage('ar')} className="mx-2 text-blue-500 hover:underline">العربية</button>
        </div>
    );

    if (auth === 'loading') return <div dir={isAr ? 'rtl' : 'ltr'} className="text-start p-6 text-center text-gray-600">{t('loading')}</div>;
    if (auth === 'denied') {
        return (
            <div dir={isAr ? 'rtl' : 'ltr'} className="text-start max-w-xl mx-auto p-6 space-y-4">
                <div className="bg-white rounded-2xl shadow-md p-4 text-gray-700">{t('notAllowed')}</div>
                <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
            </div>
        );
    }

    const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue';

    const editor = (u: UserRow) => draft && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3 text-sm" onClick={e => e.stopPropagation()}>
            <label className="block">
                <span className="block text-xs text-gray-600 mb-1">{t('field.name')}</span>
                <input className={input} value={draft.display_name} onChange={e => setDraft({ ...draft, display_name: e.target.value })} />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                    <span className="block text-xs text-gray-600 mb-1">{t('field.role')}</span>
                    <select className={input} disabled={u.is_me} value={draft.role}
                        onChange={e => { const role = e.target.value; const need = ROOM_FOR[role]; const cur = rooms.find(r => r.id === draft.err_id);
                            setDraft({ ...draft, role, err_id: need && (need === 'any' || cur?.type === need) ? draft.err_id : '' }); }}>
                        {ROLES.map(r => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                    </select>
                </label>
                <label className="block">
                    <span className="block text-xs text-gray-600 mb-1">{t('field.status')}</span>
                    <select className={input} disabled={u.is_me} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Status })}>
                        {STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                    </select>
                </label>
            </div>
            {u.is_me && <p className="text-xs text-gray-500 mb-0">{t('selfNote')}</p>}

            {ROOM_FOR[draft.role] !== null && (
                <div className="space-y-1">
                    <span className="block text-xs text-gray-600">{t(`field.room_${ROOM_FOR[draft.role]}`)}</span>
                    <input className={input} placeholder={t('roomSearch')} value={roomSearch} onChange={e => setRoomSearch(e.target.value)} />
                    <select className={input} size={6} value={draft.err_id} onChange={e => setDraft({ ...draft, err_id: e.target.value })}>
                        {roomsFor(draft.role).map(r => (
                            <option key={r.id} value={r.id}>
                                {ar(r.name, r.name_ar)}{r.err_code ? ` (${r.err_code})` : ''} — {[ar(r.locality, r.locality_ar), ar(r.state, r.state_ar)].filter(Boolean).join(' · ')}{r.status && r.status !== 'active' ? ` · ${t('roomInactive')}` : ''}
                            </option>
                        ))}
                    </select>
                    {draft.role === 'state_rep' && <p className="text-xs text-gray-500 mb-0">{t('repRoomNote')}</p>}
                </div>
            )}

            {SCOPED_STATES.includes(draft.role) && (
                <div className="space-y-2">
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={draft.can_see_all_states} onChange={e => setDraft({ ...draft, can_see_all_states: e.target.checked })} />
                        <span>{t('field.allStates')}</span>
                    </label>
                    {!draft.can_see_all_states && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                            {states.map(s => (
                                <label key={s.name} className="flex items-center gap-2 text-xs">
                                    <input type="checkbox" checked={draft.visible_states.includes(s.name)}
                                        onChange={e => setDraft({ ...draft, visible_states: e.target.checked ? [...draft.visible_states, s.name] : draft.visible_states.filter(x => x !== s.name) })} />
                                    <span>{ar(s.name, s.name_ar)}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="flex flex-wrap gap-2 justify-end">
                <button type="button" onClick={() => { setEditing(null); setDraft(null); }} className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-700">{t('cancel')}</button>
                <button type="button" disabled={busy === u.id || (ROOM_FOR[draft.role] !== null && !draft.err_id)} onClick={() => saveEdit(u)}
                    className="rounded-lg bg-brand-blue px-4 py-2 font-semibold text-white disabled:opacity-50">{busy === u.id ? t('saving') : t('save')}</button>
            </div>
        </div>
    );

    const quickActions = (u: UserRow) => !u.is_me && (
        <div className="flex flex-wrap gap-2">
            {u.status !== 'active' && (
                <button type="button" disabled={busy === u.id} onClick={() => save(u, { status: 'active' }, t('activated'))}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy === u.id ? t('saving') : t('activate')}</button>
            )}
            {u.status === 'active' && (
                <>
                    <button type="button" disabled={busy === u.id} onClick={() => sendLink(u, 'email')}
                        className="rounded-lg border border-brand-blue/50 bg-white px-3 py-1.5 text-xs font-semibold text-brand-blue disabled:opacity-50">{t('link.email')}</button>
                    <button type="button" disabled={busy === u.id} onClick={() => sendLink(u, 'copy')}
                        className="rounded-lg border border-brand-blue/50 bg-white px-3 py-1.5 text-xs font-semibold text-brand-blue disabled:opacity-50">{t('link.copy')}</button>
                    <button type="button" disabled={busy === u.id} onClick={() => save(u, { status: 'suspended' }, t('suspendedMsg'))}
                        className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50">{t('suspend')}</button>
                </>
            )}
        </div>
    );

    return (
        <div dir={isAr ? 'rtl' : 'ltr'} className="text-start min-h-screen bg-gray-100">
            <div className="max-w-6xl mx-auto p-4 pb-16 space-y-4">
                {langSwitch}
                <header className="bg-white rounded-2xl shadow-md p-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900 mb-0">{t('title')}</h1>
                        <p className="text-sm text-gray-600 mb-0">{t('subtitle')}</p>
                    </div>
                    {!showImport && (
                        <button type="button" onClick={() => { setShowImport(true); setMessage(null); }}
                            className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white">{t('import.open')}</button>
                    )}
                </header>

                {showImport && (
                    <ImportPanel rooms={rooms} isAr={isAr} t={t} getHeaders={authHeaders}
                        onClose={() => setShowImport(false)} onImported={() => { load(); setStatusFilter('pending'); }} />
                )}

                {message && (
                    <div role="status" className={`rounded-xl border p-3 text-sm ${message.kind === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-red-50 border-red-300 text-red-900'}`}>
                        {message.text}
                    </div>
                )}

                {copyBox && (
                    <div className="rounded-xl border border-brand-blue/40 bg-blue-50 p-3 space-y-2 text-sm" role="status">
                        <p className="font-semibold text-gray-900 mb-0">{t('link.copyTitle', { name: copyBox.name })}</p>
                        <p className="text-xs text-gray-600 mb-0">{t('link.copyNote')}</p>
                        <textarea readOnly dir="auto" className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs min-h-[90px]"
                            value={t('link.message', { name: copyBox.name, link: copyBox.link })} onFocus={e => e.currentTarget.select()} />
                        <div className="flex flex-wrap gap-2 items-center">
                            <button type="button" onClick={() => copyText(t('link.message', { name: copyBox.name, link: copyBox.link }), 'message')}
                                className="rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white">{t('link.copyMessage')}</button>
                            <button type="button" onClick={() => copyText(copyBox.link, 'link')}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800">{t('link.copyLinkOnly')}</button>
                            <button type="button" onClick={() => { setCopyBox(null); setCopied(''); }}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">{t('import.close')}</button>
                            {copied && <span className="text-xs text-emerald-800">{copied === 'manual' ? t('link.copyManual') : t('link.copied')}</span>}
                        </div>
                    </div>
                )}

                {(selected.size > 0 || bulk) && (
                    <div className="sticky top-2 z-10 rounded-xl border border-emerald-300 bg-emerald-50 p-3 flex flex-wrap items-center justify-between gap-2 text-sm shadow">
                        <span className="text-emerald-900">
                            {bulk ? t('bulk.progress', { done: bulk.done, total: bulk.total }) : t('bulk.selected', { count: selected.size })}
                        </span>
                        {!bulk && (
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">{t('bulk.clear')}</button>
                                <button type="button" onClick={activateSelected} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">{t('bulk.activate', { count: selected.size })}</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Totals (each one filters the list) */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <Tile label={t('tiles.all')} value={counts.all} hint={t('tiles.allHint')} active={!statusFilter} onClick={() => setStatusFilter('')} />
                    <Tile label={t('tiles.active')} value={counts.active} hint={t('tiles.activeHint')} active={statusFilter === 'active'} onClick={() => setStatusFilter('active')} />
                    <Tile label={t('tiles.pending')} value={counts.pending} hint={t('tiles.pendingHint')} active={statusFilter === 'pending'} onClick={() => setStatusFilter('pending')} />
                    <Tile label={t('tiles.suspended')} value={counts.suspended} hint={t('tiles.suspendedHint')} active={statusFilter === 'suspended'} onClick={() => setStatusFilter('suspended')} />
                    <Tile label={t('tiles.noSignIn')} value={counts.noSignIn} hint={t('tiles.noSignInHint')} active={statusFilter === 'nosignin'} onClick={() => setStatusFilter('nosignin')} />
                </div>

                {/* Roles at a glance (each one filters the list) */}
                <div className="flex flex-wrap gap-2">
                    {roleCounts.map(x => (
                        <button key={x.role} type="button" onClick={() => setRoleFilter(roleFilter === x.role ? '' : x.role)}
                            className={`rounded-full px-3 py-1 text-xs font-semibold border ${roleFilter === x.role ? 'bg-brand-blue text-white border-brand-blue' : 'bg-white text-gray-700 border-gray-300'}`}>
                            {t(`role.${x.role}`)} <bdi>{x.n}</bdi>
                        </button>
                    ))}
                </div>

                {/* Filters */}
                <div className="bg-white rounded-2xl shadow-md p-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input className={`${input} md:col-span-1`} placeholder={t('search')} value={search} onChange={e => setSearch(e.target.value)} aria-label={t('search')} />
                    <select className={input} value={roleFilter} onChange={e => setRoleFilter(e.target.value)} aria-label={t('field.role')}>
                        <option value="">{t('filter.allRoles')}</option>
                        {ROLES.map(r => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                    </select>
                    <select className={input} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label={t('field.status')}>
                        <option value="">{t('filter.allStatuses')}</option>
                        {STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                        <option value="nosignin">{t('tiles.noSignIn')}</option>
                    </select>
                    <select className={input} value={stateFilter} onChange={e => setStateFilter(e.target.value)} aria-label={t('field.state')}>
                        <option value="">{t('filter.allStates')}</option>
                        {states.map(s => <option key={s.name} value={s.name}>{ar(s.name, s.name_ar)}</option>)}
                    </select>
                </div>

                <p className="text-xs text-gray-500 px-1 mb-0">{t('showing', { shown: shown.length, total: users.length })}</p>

                {loading && users.length === 0 ? (
                    <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('loading')}</div>
                ) : shown.length === 0 ? (
                    <div className="bg-white rounded-2xl shadow-md p-4 text-gray-600">{t('empty')}</div>
                ) : (
                    <>
                        {/* Wide screens: a table */}
                        <div className="hidden md:block bg-white rounded-2xl shadow-md overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-600 text-xs">
                                    <tr>
                                        <th className="p-3 w-8">
                                            {shown.some(selectable) && (
                                                <input type="checkbox" aria-label={t('bulk.selectAll')}
                                                    checked={shown.filter(selectable).every(u => selected.has(u.id))}
                                                    onChange={e => setSelected(e.target.checked ? new Set([...Array.from(selected), ...shown.filter(selectable).map(u => u.id)]) : new Set())} />
                                            )}
                                        </th>
                                        <th className="p-3 text-start font-semibold">{t('col.user')}</th>
                                        <th className="p-3 text-start font-semibold">{t('col.role')}</th>
                                        <th className="p-3 text-start font-semibold">{t('col.scope')}</th>
                                        <th className="p-3 text-start font-semibold">{t('col.status')}</th>
                                        <th className="p-3 text-start font-semibold">{t('col.lastSignIn')}</th>
                                        <th className="p-3 text-start font-semibold">{t('col.actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {shown.map(u => (
                                        <React.Fragment key={u.id}>
                                            <tr className="align-top">
                                                <td className="p-3">
                                                    {selectable(u) && <input type="checkbox" aria-label={t('bulk.selectOne', { name: u.display_name || u.email })} checked={selected.has(u.id)} onChange={() => toggle(u.id)} />}
                                                </td>
                                                <td className="p-3">
                                                    <span className="block font-semibold text-gray-900">{u.display_name || '—'}{u.is_me && <span className="ms-1 text-xs text-gray-500">({t('you')})</span>}</span>
                                                    <span className="block text-xs text-gray-500" dir="ltr">{u.email || '—'}</span>
                                                    {u.position && <span className="block text-xs text-gray-500">{t('import.listSays', { text: u.position })}</span>}
                                                </td>
                                                <td className="p-3 text-gray-800">{t(`role.${u.role}`, { defaultValue: u.role })}</td>
                                                <td className="p-3 text-gray-700 max-w-xs">{scopeText(u)}</td>
                                                <td className="p-3">
                                                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CHIP[u.status] || STATUS_CHIP.deleted}`}>{t(`status.${u.status}`)}</span>
                                                    {linkStatus(u) && <span className="block mt-1 text-xs text-gray-500">{linkStatus(u)}</span>}
                                                </td>
                                                <td className="p-3 text-gray-600 whitespace-nowrap">{fmtDate(u.last_sign_in_at)}</td>
                                                <td className="p-3">
                                                    <div className="flex flex-wrap gap-2">
                                                        <button type="button" onClick={() => (editing === u.id ? (setEditing(null), setDraft(null)) : openEdit(u))}
                                                            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800">{t('edit')}</button>
                                                        {quickActions(u)}
                                                    </div>
                                                </td>
                                            </tr>
                                            {editing === u.id && <tr><td colSpan={7} className="px-3 pb-3">{editor(u)}</td></tr>}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Phones: cards */}
                        <ul className="md:hidden space-y-3">
                            {shown.map(u => (
                                <li key={u.id} className="bg-white rounded-2xl shadow-md p-4 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        {selectable(u) && <input type="checkbox" className="mt-1 shrink-0" aria-label={t('bulk.selectOne', { name: u.display_name || u.email })} checked={selected.has(u.id)} onChange={() => toggle(u.id)} />}
                                        <div className="min-w-0 flex-1">
                                            <p className="font-bold text-gray-900 mb-0">{u.display_name || '—'}{u.is_me && <span className="ms-1 text-xs text-gray-500">({t('you')})</span>}</p>
                                            <p className="text-xs text-gray-500 mb-0 break-all" dir="ltr">{u.email || '—'}</p>
                                        </div>
                                        <span className={`shrink-0 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CHIP[u.status] || STATUS_CHIP.deleted}`}>{t(`status.${u.status}`)}</span>
                                    </div>
                                    <p className="text-sm text-gray-800 mb-0"><span className="text-gray-500">{t('col.role')}: </span>{t(`role.${u.role}`, { defaultValue: u.role })}</p>
                                    <p className="text-sm text-gray-700 mb-0"><span className="text-gray-500">{t('col.scope')}: </span>{scopeText(u)}</p>
                                    {u.position && <p className="text-xs text-gray-500 mb-0">{t('import.listSays', { text: u.position })}</p>}
                                    <p className="text-xs text-gray-500 mb-0">{t('col.lastSignIn')}: {fmtDate(u.last_sign_in_at)}</p>
                                    {linkStatus(u) && <p className="text-xs text-gray-500 mb-0">{linkStatus(u)}</p>}
                                    <div className="flex flex-wrap gap-2 pt-1">
                                        <button type="button" onClick={() => (editing === u.id ? (setEditing(null), setDraft(null)) : openEdit(u))}
                                            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800">{t('edit')}</button>
                                        {quickActions(u)}
                                    </div>
                                    {editing === u.id && editor(u)}
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
            </div>
        </div>
    );
};

export default UserManagement;
