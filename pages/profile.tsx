// My account: every signed-in person sees their own details and changes their name, password and
// language, signs out other devices, or logs out. Email, role and room are changed by an admin.
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button';
import { newSupabase } from '../services/newSupabaseClient';
import { signOutAndLock } from '../services/appLock';

interface Profile {
    id: string; display_name: string | null; email: string | null; role: string; status: string;
    room_name: string | null; room_name_ar: string | null; room_type: string | null; err_code: string | null;
    locality: string | null; locality_ar: string | null; state: string | null; state_ar: string | null;
    can_see_all_states: boolean; visible_states: string[]; position: string | null;
    created_at: string | null; last_sign_in_at: string | null;
}
type Note = { kind: 'ok' | 'error'; text: string } | null;

const card = 'bg-white rounded-2xl shadow-md p-4 space-y-3';
const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue';
const btnPrimary = 'rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const btnLine = 'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 disabled:opacity-50';

const NoteBox: React.FC<{ note: Note }> = ({ note }) => note ? (
    <p role="status" className={`mb-0 rounded-lg px-3 py-2 text-sm ${note.kind === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>{note.text}</p>
) : null;

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] sm:grid-cols-[9rem_minmax(0,1fr)] gap-2 text-sm">
        <span className="text-gray-500">{label}</span>
        <span className="text-gray-900 break-words">{children}</span>
    </div>
);

const PasswordInput: React.FC<{ value: string; onChange: (v: string) => void; label: string; auto: string; show: boolean }> = ({ value, onChange, label, auto, show }) => (
    <label className="block">
        <span className="block text-xs text-gray-600 mb-1">{label}</span>
        <input className={input} type={show ? 'text' : 'password'} value={value} autoComplete={auto} dir="ltr"
            onChange={e => onChange(e.target.value)} />
    </label>
);

const ProfilePage: React.FC = () => {
    const router = useRouter();
    const { t, i18n } = useTranslation(['profile', 'userManagement']);
    const isAr = i18n.language === 'ar';
    const pick = (en?: string | null, ar?: string | null) => (isAr ? ar || en : en || ar) || '';
    const fmtDate = (d: string | null | undefined) =>
        d ? new Date(d).toLocaleDateString(isAr ? 'ar-SD' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

    const [profile, setProfile] = useState<Profile | null>(null);
    const [loadError, setLoadError] = useState(false);

    const [name, setName] = useState('');
    const [editingName, setEditingName] = useState(false);
    const [nameBusy, setNameBusy] = useState(false);
    const [nameNote, setNameNote] = useState<Note>(null);

    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [pwBusy, setPwBusy] = useState(false);
    const [pwNote, setPwNote] = useState<Note>(null);

    const [devBusy, setDevBusy] = useState(false);
    const [devNote, setDevNote] = useState<Note>(null);
    const [leaving, setLeaving] = useState(false);

    const load = useCallback(async () => {
        setLoadError(false);
        const { data: { session } } = await newSupabase.auth.getSession();
        if (!session) { router.push('/login'); return; }
        const { data, error } = await newSupabase.rpc('me_profile');
        if (error || !data) { setLoadError(true); return; }
        setProfile(data as Profile);
        setName((data as Profile).display_name || '');
    }, [router]);
    useEffect(() => { load().catch(() => setLoadError(true)); }, [load]);

    const saveName = async () => {
        const clean = name.replace(/\s+/g, ' ').trim();
        if (clean.length < 2 || clean.length > 80) { setNameNote({ kind: 'error', text: t('name.invalid') }); return; }
        setNameBusy(true); setNameNote(null);
        const { data, error } = await newSupabase.rpc('me_update_name', { p_name: clean });
        setNameBusy(false);
        if (error) { setNameNote({ kind: 'error', text: t((error.message || '').includes('invalid_name') ? 'name.invalid' : 'error') }); return; }
        setProfile(p => (p ? { ...p, display_name: (data as any)?.display_name ?? clean } : p));
        setName((data as any)?.display_name ?? clean);
        setEditingName(false);
        setNameNote({ kind: 'ok', text: t('name.saved') });
    };

    const changePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPwNote(null);
        if (!current || !next) { setPwNote({ kind: 'error', text: t('password.fillAll') }); return; }
        if (next.length < 8) { setPwNote({ kind: 'error', text: t('password.tooShort') }); return; }
        if (next !== confirm) { setPwNote({ kind: 'error', text: t('password.mismatch') }); return; }
        if (next === current) { setPwNote({ kind: 'error', text: t('password.same') }); return; }
        if (!profile?.email) { setPwNote({ kind: 'error', text: t('error') }); return; }
        setPwBusy(true);
        try {
            // Check the current password first, so a phone left unlocked can't be used to take the account.
            const { error: checkError } = await newSupabase.auth.signInWithPassword({ email: profile.email, password: current });
            if (checkError) {
                const tooMany = (checkError as any)?.status === 429;
                setPwNote({ kind: 'error', text: t(tooMany ? 'password.tooManyTries' : 'password.wrongCurrent') });
                return;
            }
            const { error } = await newSupabase.auth.updateUser({ password: next });
            if (error) {
                const code = (error as any)?.code || '';
                setPwNote({ kind: 'error', text: t(code === 'same_password' ? 'password.same' : code === 'weak_password' ? 'password.weak' : 'error') });
                return;
            }
            // Anyone still signed in elsewhere with the old password is signed out.
            await newSupabase.auth.signOut({ scope: 'others' }).catch(() => undefined);
            setCurrent(''); setNext(''); setConfirm(''); setShowPw(false);
            setPwNote({ kind: 'ok', text: t('password.saved') });
        } catch {
            setPwNote({ kind: 'error', text: t('error') });
        } finally {
            setPwBusy(false);
        }
    };

    const signOutOthers = async () => {
        setDevBusy(true); setDevNote(null);
        const { error } = await newSupabase.auth.signOut({ scope: 'others' });
        setDevBusy(false);
        setDevNote(error ? { kind: 'error', text: t('error') } : { kind: 'ok', text: t('devices.done') });
    };

    // Messages on screen were written in the old language, so they go.
    const changeLanguage = (lng: 'ar' | 'en') => { setNameNote(null); setPwNote(null); setDevNote(null); i18n.changeLanguage(lng); };

    // What this person can see, in words
    const scope = (p: Profile) => {
        if (p.role === 'superadmin' || p.role === 'lcc_wg') return t('scope.allStates', { ns: 'userManagement' });
        if (p.role === 'admin' || p.role === 'support') {
            if (p.can_see_all_states) return t('scope.allStates', { ns: 'userManagement' });
            return p.visible_states.length ? p.visible_states.join(isAr ? '، ' : ', ') : t('scope.none', { ns: 'userManagement' });
        }
        if (p.role === 'state_rep') return t('access.stateRep', { state: pick(p.state, p.state_ar), locality: pick(p.locality, p.locality_ar) });
        if (p.role === 'state_err') return t('access.state', { state: pick(p.state, p.state_ar) });
        if (p.role === 'locality_err') return t('access.locality', { locality: pick(p.locality, p.locality_ar) });
        return t('access.room');
    };

    const shell = (body: React.ReactNode) => (
        <div dir={isAr ? 'rtl' : 'ltr'} className="text-start min-h-screen bg-gray-100">
            <div className="max-w-xl mx-auto p-4 pb-16 space-y-4">{body}</div>
        </div>
    );

    if (loadError) return shell(<>
        <div className={card}><p className="mb-0 text-gray-700">{t('loadError')}</p></div>
        <Button text={t('retry')} onClick={() => load()} className="w-full" />
        <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
    </>);
    if (!profile) return shell(<div className={card}><p className="mb-0 text-gray-600">{t('loading')}</p></div>);

    const initials = (profile.display_name || profile.email || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('');

    return shell(<>
        <header className={`${card} flex items-center gap-3 space-y-0`}>
            <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-blue text-lg font-bold text-white">{initials}</span>
            <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900 mb-0 break-words">{profile.display_name || t('noName')}</h1>
                <p className="text-sm text-gray-600 mb-0">{t(`role.${profile.role}`, { ns: 'userManagement', defaultValue: profile.role })}</p>
            </div>
        </header>

        {/* Name and email */}
        <section className={card} aria-labelledby="sec-account">
            <h2 id="sec-account" className="text-base font-bold text-gray-900 mb-0">{t('account.title')}</h2>
            {editingName ? (
                <div className="space-y-2">
                    <label className="block">
                        <span className="block text-xs text-gray-600 mb-1">{t('name.label')}</span>
                        <input className={input} value={name} maxLength={80} autoComplete="name" onChange={e => setName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveName(); }} autoFocus />
                    </label>
                    <p className="text-xs text-gray-500 mb-0">{t('name.hint')}</p>
                    <div className="flex flex-wrap gap-2 justify-end">
                        <button type="button" className={btnLine} onClick={() => { setEditingName(false); setName(profile.display_name || ''); setNameNote(null); }}>{t('cancel')}</button>
                        <button type="button" className={btnPrimary} disabled={nameBusy} onClick={saveName}>{nameBusy ? t('saving') : t('save')}</button>
                    </div>
                </div>
            ) : (
                <div className="flex items-start justify-between gap-2">
                    <Row label={t('name.label')}>{profile.display_name || '—'}</Row>
                    <button type="button" className="shrink-0 text-sm font-semibold text-brand-blue underline" onClick={() => { setEditingName(true); setNameNote(null); }}>{t('edit')}</button>
                </div>
            )}
            <NoteBox note={nameNote} />
            <Row label={t('account.email')}><bdi dir="ltr">{profile.email || '—'}</bdi></Row>
            <Row label={t('account.since')}>{fmtDate(profile.created_at)}</Row>
            <Row label={t('account.lastSignIn')}>{fmtDate(profile.last_sign_in_at)}</Row>
        </section>

        {/* Role and where they work */}
        <section className={card} aria-labelledby="sec-access">
            <h2 id="sec-access" className="text-base font-bold text-gray-900 mb-0">{t('access.title')}</h2>
            <Row label={t('access.role')}>{t(`role.${profile.role}`, { ns: 'userManagement', defaultValue: profile.role })}</Row>
            {profile.position && <Row label={t('access.position')}>{profile.position}</Row>}
            {profile.room_name && (
                <Row label={t('access.roomLabel')}>{pick(profile.room_name, profile.room_name_ar)}{profile.err_code ? <span className="text-gray-500"> (<bdi>{profile.err_code}</bdi>)</span> : null}</Row>
            )}
            {profile.locality && <Row label={t('access.localityLabel')}>{pick(profile.locality, profile.locality_ar)}</Row>}
            {profile.state && <Row label={t('access.stateLabel')}>{pick(profile.state, profile.state_ar)}</Row>}
            <Row label={t('access.sees')}>{scope(profile)}</Row>
            <p className="text-xs text-gray-500 mb-0">{t('access.askAdmin')}</p>
        </section>

        {/* Password */}
        <section className={card} aria-labelledby="sec-password">
            <h2 id="sec-password" className="text-base font-bold text-gray-900 mb-0">{t('password.title')}</h2>
            <form onSubmit={changePassword} className="space-y-3">
                {/* For password managers: which account this is */}
                <input type="email" value={profile.email || ''} autoComplete="username" readOnly hidden />
                <PasswordInput label={t('password.current')} value={current} onChange={setCurrent} auto="current-password" show={showPw} />
                <PasswordInput label={t('password.new')} value={next} onChange={setNext} auto="new-password" show={showPw} />
                <PasswordInput label={t('password.confirm')} value={confirm} onChange={setConfirm} auto="new-password" show={showPw} />
                <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} />
                    {t('password.show')}
                </label>
                <p className="text-xs text-gray-500 mb-0">{t('password.hint')}</p>
                <NoteBox note={pwNote} />
                <div className="flex justify-end">
                    <button type="submit" className={btnPrimary} disabled={pwBusy}>{pwBusy ? t('saving') : t('password.submit')}</button>
                </div>
            </form>
        </section>

        {/* Language */}
        <section className={card} aria-labelledby="sec-language">
            <h2 id="sec-language" className="text-base font-bold text-gray-900 mb-0">{t('language.title')}</h2>
            <div className="flex gap-2" role="group" aria-labelledby="sec-language">
                {(['ar', 'en'] as const).map(l => (
                    <button key={l} type="button" aria-pressed={i18n.language === l} onClick={() => changeLanguage(l)}
                        className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold ${i18n.language === l ? 'border-brand-blue bg-brand-blue text-white' : 'border-gray-300 bg-white text-gray-800'}`}>
                        {l === 'ar' ? 'العربية' : 'English'}
                    </button>
                ))}
            </div>
        </section>

        {/* Devices and log out */}
        <section className={card} aria-labelledby="sec-devices">
            <h2 id="sec-devices" className="text-base font-bold text-gray-900 mb-0">{t('devices.title')}</h2>
            <p className="text-sm text-gray-600 mb-0">{t('devices.hint')}</p>
            <NoteBox note={devNote} />
            <div className="flex flex-wrap gap-2">
                <button type="button" className={btnLine} disabled={devBusy} onClick={signOutOthers}>{devBusy ? t('saving') : t('devices.signOutOthers')}</button>
                <button type="button" disabled={leaving} onClick={() => { setLeaving(true); signOutAndLock(); }}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('devices.logOut')}</button>
            </div>
        </section>

        <Button text={t('backToMenu')} onClick={() => router.push('/menu')} className="w-full" />
    </>);
};

export default ProfilePage;
