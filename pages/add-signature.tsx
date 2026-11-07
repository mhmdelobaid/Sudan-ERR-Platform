// pages/add-signature.tsx
// Shown right after sign-in to a room's program, finance or reporting officer who hasn't saved a signature yet
// (for a new account: after they set their password and sign in for the first time). They draw it once and
// it is saved in their account, so F1, F3, F4 and F5 are signed with one tap. "Later" goes on to the menu;
// they are asked again at the next sign-in until a signature is saved. Anyone else is sent straight on.
import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import SignaturePad, { SignaturePadHandle } from '../components/ui/SignaturePad';
import Icon from '../components/ui/Icon';
import { saveMySignature } from '../components/signatures/signApi';
import { newSupabase } from '../services/newSupabaseClient';

const LogoImage = '/brand/err-logo.png';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50';
const btnLine = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 disabled:opacity-50';

type Position = 'program' | 'finance' | 'reporting';

const AddSignature: React.FC = () => {
    const router = useRouter();
    const { t, i18n } = useTranslation('signatures');
    const isAr = i18n.language === 'ar';

    const [position, setPosition] = useState<Position | null>(null);
    const [empty, setEmpty] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const pad = useRef<SignaturePadHandle>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data: { session } } = await newSupabase.auth.getSession();
            if (!session) { router.replace('/login'); return; }
            const { data } = await newSupabase.rpc('me_profile');
            const me = (data || {}) as { officer_position?: Position | null; has_signature?: boolean };
            if (cancelled) return;
            // Not an officer, or already saved: nothing to ask.
            if (!me.officer_position || me.has_signature) { router.replace('/home'); return; }
            setPosition(me.officer_position);
        })().catch(() => { if (!cancelled) router.replace('/home'); });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const save = async () => {
        const png = pad.current?.toDataURL();
        if (!png) return;
        setBusy(true); setError(null);
        try {
            await saveMySignature(png);
            setSaved(true);
            setTimeout(() => router.replace('/home'), 1200);
        } catch (e: any) {
            setError(t(e?.message === 'invalid_signature' ? 'errors.invalid_signature' : 'errors.server_error'));
            setBusy(false);
        }
    };

    if (!position) {
        return <div dir={isAr ? 'rtl' : 'ltr'} className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-600">{t('loading')}</div>;
    }

    return (
        <div dir={isAr ? 'rtl' : 'ltr'} className="text-start min-h-screen bg-gray-50 px-4 py-8">
            <div className="max-w-md mx-auto space-y-4">
                <div className="flex justify-end text-sm">
                    <button onClick={() => i18n.changeLanguage('en')} className="mx-2 text-blue-500 hover:underline">English</button>
                    <button onClick={() => i18n.changeLanguage('ar')} className="mx-2 text-blue-500 hover:underline">العربية</button>
                </div>
                <div className="flex flex-col items-center text-center">
                    <Image src={LogoImage} alt="ERR" width={80} height={80} className="mb-2" priority />
                    <h1 className="text-xl font-bold text-gray-900 mb-1">{t('welcome.title')}</h1>
                    <p className="text-sm text-gray-600 mb-0">{t('welcome.intro', { position: t(`position.${position}`) })}</p>
                </div>

                <section className="bg-white rounded-2xl shadow-md p-4 space-y-3">
                    {saved ? (
                        <div role="status" className="flex items-center gap-2 rounded-xl border p-3 text-sm bg-emerald-50 border-emerald-300 text-emerald-900">
                            <Icon name="check_circle" size={20} />{t('welcome.saved')}
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-gray-800">{t('welcome.drawHere')}</span>
                                <button type="button" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1.5" onClick={() => pad.current?.clear()} disabled={busy}>
                                    <Icon name="ink_eraser" size={18} />{t('confirm.clear')}
                                </button>
                            </div>
                            <SignaturePad ref={pad} onChange={setEmpty} ariaLabel={t('welcome.drawHere')} />
                            <p className="text-xs text-gray-500 mb-0">{t('welcome.where')}</p>
                            {error && <p role="alert" className="text-sm text-red-700 mb-0">{error}</p>}
                            <div className="flex flex-col gap-2 pt-1">
                                <button type="button" className={btnPrimary} disabled={busy || empty} onClick={save}>
                                    <Icon name="save" size={20} />{busy ? t('welcome.saving') : t('welcome.save')}
                                </button>
                                <button type="button" className={btnLine} disabled={busy} onClick={() => router.replace('/home')}>
                                    <Icon name="skip_next" size={20} />{t('welcome.later')}
                                </button>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
};

export default AddSignature;
