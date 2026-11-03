// components/signatures/SignConfirm.tsx
// The "sign this document" window. Shows the officer's saved signature and signs with one tap; the first time,
// when nothing is saved yet, they draw it here and it is saved to their account (حسابي) before signing.
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SignaturePad, { SignaturePadHandle } from '../ui/SignaturePad';
import ProjectFileLink from '../ui/ProjectFileLink';
import { newSupabase } from '../../services/newSupabaseClient';
import { DocType, errorCode, saveMySignature, signDocument } from './signApi';

interface Props {
    docType: DocType;
    docId: string;
    projectId?: string | null;
    title: string;               // e.g. the MOU code or project name
    summary?: React.ReactNode;   // a few fields about the document
    roomName: string;
    onSigned: (complete: boolean) => void;
    onClose: () => void;
}

const SignConfirm: React.FC<Props> = ({ docType, docId, projectId, title, summary, roomName, onSigned, onClose }) => {
    const { t, i18n } = useTranslation('signatures');
    const isAr = i18n.language === 'ar';
    const padRef = useRef<SignaturePadHandle>(null);

    const [loading, setLoading] = useState(true);
    const [position, setPosition] = useState<string | null>(null);
    const [saved, setSaved] = useState<string | null>(null);
    const [agreed, setAgreed] = useState(false);
    const [padEmpty, setPadEmpty] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            const { data, error: e } = await newSupabase.rpc('me_profile');
            if (!alive) return;
            if (e || !data) { setError(t('errors.server_error')); }
            else { setPosition((data as any).officer_position || null); setSaved((data as any).signature_png || null); }
            setLoading(false);
        })();
        return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const canSubmit = agreed && !busy && !loading && (!!saved || !padEmpty);

    const submit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setError(null);
        try {
            if (!saved) {
                const png = padRef.current?.toDataURL();
                if (!png) { setBusy(false); return; }
                const r = await saveMySignature(png);
                setSaved(r.signature_png);
            }
            const result = await signDocument(docType, docId);
            onSigned(!!result.complete);
        } catch (e: any) {
            const code = errorCode(e?.message);
            setError(t(`errors.${code}`, { defaultValue: t('errors.server_error') }));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-2" role="dialog" aria-modal="true" aria-labelledby="sign-confirm-title"
            onClick={() => { if (!busy) onClose(); }}>
            <div dir={isAr ? 'rtl' : 'ltr'} onClick={e => e.stopPropagation()}
                className="text-start w-full max-w-lg max-h-[95vh] overflow-y-auto rounded-2xl bg-white p-4 space-y-3 shadow-xl">
                <div>
                    <p className="text-xs font-semibold text-blue-800 mb-0">{t(`docType.${docType}`)}</p>
                    <h2 id="sign-confirm-title" className="text-lg font-bold text-gray-900 mb-0 break-words"><bdi>{title}</bdi></h2>
                    {position && <p className="text-sm text-gray-600 mb-0">{t('confirm.signAs', { position: t(`position.${position}`) })}</p>}
                </div>

                {summary && <div className="rounded-xl bg-gray-50 p-3">{summary}</div>}
                {projectId && (
                    <div className="space-y-1">
                        <p className="text-xs text-gray-500 mb-0">{t('confirm.read')}</p>
                        <ProjectFileLink projectId={projectId} step={docType} />
                    </div>
                )}

                <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
                    <span>{t(`confirm.agree.${docType}`, { room: roomName })}</span>
                </label>

                {loading ? (
                    <p className="text-sm text-gray-500 mb-0">{t('loading')}</p>
                ) : saved ? (
                    <div>
                        <p className="text-sm font-semibold text-gray-900 mb-1">{t('confirm.saved')}</p>
                        <div className="rounded-xl border border-gray-200 bg-white p-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={saved} alt={t('savedSignature')} className="h-20 w-full object-contain" />
                        </div>
                    </div>
                ) : (
                    <div>
                        <div className="flex items-center justify-between mb-1 gap-2">
                            <span className="text-sm font-semibold text-gray-900">{t('confirm.drawFirst')}</span>
                            <button type="button" onClick={() => padRef.current?.clear()} className="shrink-0 text-sm text-blue-600 hover:underline">{t('confirm.clear')}</button>
                        </div>
                        <SignaturePad ref={padRef} onChange={setPadEmpty} ariaLabel={t('confirm.drawFirst')} />
                    </div>
                )}
                <p className="text-xs text-gray-500 mb-0">{t('confirm.final')}</p>

                {error && <div role="alert" className="rounded-xl border p-3 text-sm bg-red-50 border-red-300 text-red-900">{error}</div>}

                <div className="flex gap-2">
                    <button onClick={submit} disabled={!canSubmit}
                        className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-40 hover:bg-blue-700">
                        {busy ? t('confirm.sending') : t('confirm.button')}
                    </button>
                    <button onClick={onClose} disabled={busy} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-800">
                        {t('confirm.cancel')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SignConfirm;
