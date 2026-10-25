import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import Image from 'next/image';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { newSupabase } from '../services/newSupabaseClient';
import { isUnlocked } from '../services/appLock';

const LogoImage = '/brand/err-logo.png';

const UpdatePassword = () => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    // 'checking' while the link is read, 'ready' when there is a session to set the password on, 'invalid' otherwise
    const [linkState, setLinkState] = useState<'checking' | 'ready' | 'invalid' | 'saved'>('checking');
    
    const router = useRouter();
    const { t, i18n } = useTranslation('login');

    // The page is opened from three kinds of link:
    //  1. ?token_hash=...&type=recovery  — a link an admin copied, or the email template that uses {{ .TokenHash }}
    //  2. #access_token=...              — the default Supabase email sent by the app's server
    //  3. ?code=...                       — "Forgot password" asked in this same browser (the client handles it)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            // Wait for the client to finish its own reading of the URL first.
            await newSupabase.auth.getSession();
            const url = new URL(window.location.href);
            const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
            const tokenHash = url.searchParams.get('token_hash');
            let failed = !!(hash.get('error_code') || url.searchParams.get('error_code'));

            if (!failed && tokenHash) {
                const { error: otpError } = await newSupabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
                failed = !!otpError;
            } else if (!failed && hash.get('access_token') && hash.get('refresh_token')) {
                const { error: sessionError } = await newSupabase.auth.setSession({
                    access_token: hash.get('access_token') as string,
                    refresh_token: hash.get('refresh_token') as string,
                });
                failed = !!sessionError;
            }
            // Keep tokens out of the address bar and browser history.
            if (tokenHash || url.hash) window.history.replaceState(window.history.state, '', url.pathname);

            const { data: { session } } = await newSupabase.auth.getSession();
            if (!cancelled) setLinkState(!failed && session ? 'ready' : 'invalid');
        })().catch(() => { if (!cancelled) setLinkState('invalid'); });
        return () => { cancelled = true; };
    }, []);

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (password !== confirmPassword) {
            setError(t('passwordsDoNotMatch'));
            return;
        }
        if (password.length < 8) {
            setError(t('passwordTooShort'));
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            const { error: updateError } = await newSupabase.auth.updateUser({
                password: password
            });

            if (updateError) {
                setError(t('passwordUpdateError'));
            } else {
                // Sign out here and let them sign in with the new password
                await newSupabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
                // Opened from inside the app: go to sign in. Opened from an email: the app needs the calculator code first.
                if (isUnlocked()) router.push('/login?password=updated');
                else setLinkState('saved');
            }
        } catch (err) {
            setError(t('unexpectedError'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-gray-50">
            <div className="flex flex-col items-center mb-6">
                <Image
                    src={LogoImage}
                    alt={t('logoAlt')}
                    width={100}
                    height={100}
                    className="mb-2"
                    priority
                />
                <h1 className="text-xl font-bold text-center">{t('updatePasswordTitle')}</h1>
                {linkState === 'ready' && <p className="mt-2 text-center text-gray-600 max-w-xs">{t('updatePasswordHint')}</p>}
            </div>

            {linkState === 'saved' && <p className="w-full max-w-xs text-center text-green-700">{t('passwordSavedOpenApp')}</p>}
            {linkState === 'checking' && <p className="text-gray-600 text-center">{t('checkingLink')}</p>}
            {linkState === 'invalid' && (
                <div className="w-full max-w-xs space-y-4 text-center">
                    <p className="text-gray-700">{t('linkInvalid')}</p>
                    <Link href="/reset-password" className="block text-blue-600 hover:text-blue-800">{t('getNewLink')}</Link>
                    <Link href="/login" className="block text-blue-600 hover:text-blue-800">{t('backToLogin')}</Link>
                </div>
            )}
            {linkState === 'ready' && (
            <form onSubmit={handleUpdatePassword} className="flex flex-col space-y-4 w-full max-w-xs">
                <div className="relative">
                    <Input
                        type={showPassword ? "text" : "password"}
                        placeholder={t('newPasswordPlaceholder')}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}
                    />
                    <button
                        type="button"
                        className={`absolute top-1/2 transform -translate-y-1/2 ${i18n.language === 'ar' ? 'left-2' : 'right-2'}`}
                        onClick={() => setShowPassword(!showPassword)}
                    >
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            {showPassword ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            )}
                        </svg>
                    </button>
                </div>

                <div className="relative">
                    <Input
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder={t('confirmPasswordPlaceholder')}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}
                    />
                    <button
                        type="button"
                        className={`absolute top-1/2 transform -translate-y-1/2 ${i18n.language === 'ar' ? 'left-2' : 'right-2'}`}
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            {showConfirmPassword ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            )}
                        </svg>
                    </button>
                </div>

                {error && <p className="text-red-500 text-sm text-center">{error}</p>}

                <Button
                    text={isLoading ? t('updatingPassword') : t('updatePasswordButton')}
                    type="submit"
                    disabled={isLoading}
                />
            </form>
            )}
        </div>
    );
};

export default UpdatePassword; 