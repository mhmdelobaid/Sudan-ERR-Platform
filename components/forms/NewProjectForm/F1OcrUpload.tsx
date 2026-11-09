import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CameraButton from '../../ui/CameraButton';
import { useRouter } from 'next/router';
import { ChevronRight } from 'lucide-react';
import F1ScopeFields, { emptyF1Scope, F1ScopeValue, scopeIsReady } from './F1ScopeFields';
import { newSupabase } from '../../../services/newSupabaseClient';
import i18n from '../../../services/i18n';
import type { F1OcrReviewPayload, MapExtractedData } from '../../../lib/f1/mapReviewTypes';

const MAX_FILE_SIZE = 40 * 1024 * 1024;
const DEFAULT_SDG_RATE = 2700;

type F1OcrUploadProps = {
  /** Currency and exchange rate: state level and staff only. Others: the AI reads the currency from the form. */
  showCurrency?: boolean;
  onBack: () => void;
  onOcrComplete: (payload: F1OcrReviewPayload) => void;
};

export default function F1OcrUpload({ onBack, onOcrComplete, showCurrency = true }: F1OcrUploadProps) {
  const { t: tx } = useTranslation('app');
  // A chosen file or a photo from the camera: checked, then uploaded for the AI to read
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0] || null;
    setFile(null);
    setTempFileKey(null);
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) {
      setError(tx('x.fileTooLargeMax40mb'));
      return;
    }
    void uploadTemp(f);
  };
  const router = useRouter();
  const locale = router.locale || 'en';
  const [scope, setScope] = useState<F1ScopeValue>(emptyF1Scope);
  const [currency, setCurrency] = useState<'USD' | 'SDG'>('SDG');
  // The rate is set per state by admins (/state-rates); the F1 has no rate field (decision 10 Nov 2026)
  const [stateRates, setStateRates] = useState<Record<string, number>>({});
  const [stateNamesAr, setStateNamesAr] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [tempFileKey, setTempFileKey] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    scopeIsReady(scope) && !!file && !!tempFileKey;

  const uploadTemp = async (selected: File) => {
    setUploadingFile(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await newSupabase.auth.getSession();
      if (!session) throw new Error(tx('x.notSignedIn'));

      // Upload to Prod Storage via API (not staging)
      const body = new FormData();
      body.append('file', selected);
      const res = await fetch('/api/f1/temp-upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });
      const result = await res.json();
      if (!res.ok || !result.success || !result.temp_file_key) {
        throw new Error(result.code ? i18n.t(`uploads:errors.${result.code}`) : result.message || tx('x.failedToUploadFileToProd'));
      }
      setFile(selected);
      setTempFileKey(result.temp_file_key);
    } catch (e: any) {
      setFile(null);
      setTempFileKey(null);
      setError(e.message || tx('x.failedToUploadFile'));
    } finally {
      setUploadingFile(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await newSupabase.auth.getSession();
        if (!session) return;
        const res = await fetch('/api/state-rates', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const body = await res.json().catch(() => ({}));
        const map: Record<string, number> = {};
        const ar: Record<string, string> = {};
        for (const r of body?.states || []) {
          if (r?.sdg_per_usd != null) map[r.state_name] = Number(r.sdg_per_usd);
          if (r?.state_name_ar) ar[r.state_name] = r.state_name_ar;
        }
        setStateRates(map);
        setStateNamesAr(ar);
      } catch { /* the default rate is used */ }
    })();
  }, []);
  const stateRate = scope.state_name ? stateRates[scope.state_name] : undefined;
  const stateShown = (scope.state_name && i18n.language?.startsWith('ar') && stateNamesAr[scope.state_name]) || scope.state_name;
  const parsedExchangeRate = stateRate && stateRate > 0 ? stateRate : DEFAULT_SDG_RATE;

  const runOcr = async () => {
    if (!ready || !file || !tempFileKey) return;
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await newSupabase.auth.getSession();
      if (!session) throw new Error(tx('x.notSignedIn'));

      // Without the picker the AI detects the currency; SDG amounts use the rate of the room's state
      const sentCurrency = showCurrency ? currency : 'auto';
      const rate = !showCurrency ? parsedExchangeRate : currency === 'SDG' ? parsedExchangeRate : 1;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('form_type', 'F1');
      formData.append('currency', sentCurrency);
      formData.append('exchange_rate', String(rate));
      formData.append('err_id', scope.emergency_room_id);

      const res = await fetch('/api/ocr/process', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.code === 'ai_not_configured' ? tx('x.aiNotConfigured') : result.message || tx('x.ocrFailed'));
      }

      const extracted = result.data as MapExtractedData;
      // State/locality come from the room selected before upload (app locale),
      // not from OCR — Arabic forms would otherwise overwrite EN labels.
      onOcrComplete({
        extracted: {
          ...extracted,
          form_currency: extracted.form_currency || (showCurrency ? currency : 'USD'),
          exchange_rate: extracted.exchange_rate ?? rate,
          state: scope.state_name || extracted.state || null,
          locality: scope.locality || extracted.locality || null,
        },
        emergency_room_id: scope.emergency_room_id,
        grant_segment: scope.grant_segment,
        working_group_id: scope.working_group_id,
        working_group_label: scope.working_group_label,
        organization_id: scope.organization_id,
        organization_label: scope.organization_label,
        state_name: scope.state_name,
        locality: scope.locality,
        room_label: scope.room_label,
        temp_file_key: tempFileKey,
        form_currency: extracted.form_currency || (showCurrency ? currency : 'USD'),
        exchange_rate: extracted.exchange_rate ?? rate,
        file,
        file_name: file.name,
        file_type: file.type,
      });
    } catch (e: any) {
      setError(e.message || tx('x.ocrFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-4">
        <p className="app-section-label mb-0.5">{tx('x.f1UploadWithAi')}</p>
        <h2 className="text-lg font-bold text-white leading-snug">{tx('x.uploadF1WorkPlan')}</h2>
      </div>

      <div className="grid gap-2.5 mb-4">
        <F1ScopeFields
          value={scope}
          onChange={setScope}
          locale={locale}
          compact
        />

        <div className="grid grid-cols-[1fr_auto] gap-2.5 items-end">
          <div className="min-w-0">
            <label className="font-semibold block text-xs text-[#a8b6cc] mb-1">
              {tx('x.f1FilePdfOrWord')}
            </label>
            {/* A labelled button instead of the browser's own file box (it shows English text on phones) */}
            <label className={`app-input !py-2 flex items-center gap-2 cursor-pointer ${uploadingFile || loading ? 'opacity-60 pointer-events-none' : ''}`}>
              <span className="shrink-0 rounded-md bg-brand-orange text-[#152238] font-semibold px-2.5 py-1 text-xs">{tx('x.chooseFile')}</span>
              <span className="min-w-0 truncate text-sm text-[#a8b6cc]">{file ? file.name : tx('x.noFileChosen')}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="sr-only"
                disabled={uploadingFile || loading}
                onChange={onPickFile}
              />
            </label>
            <CameraButton onChange={onPickFile} disabled={uploadingFile || loading}
              className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand-orange/60 text-brand-orange px-3 py-1.5 text-xs font-bold" />
          </div>
          {showCurrency && (
          <div>
            <label className="font-semibold block text-xs text-[#a8b6cc] mb-1">{tx('x.currency')}</label>
            <div className="inline-flex rounded-lg border border-white/15 overflow-hidden">
              {(['SDG', 'USD'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setCurrency(code)}
                  className={`px-3 py-2 text-xs font-semibold ${
                    currency === code
                      ? 'bg-brand-orange text-[#152238]'
                      : 'bg-[#152238] text-[#a8b6cc]'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>
          )}
        </div>

        {showCurrency && currency === 'SDG' && scope.state_name && (
          // The rate comes from the state (set by admins on the State exchange rates page), not typed here
          <p className="text-xs text-[#8a97ab] mb-0">
            {stateRate
              ? tx('x.stateRate', { state: stateShown, rate: new Intl.NumberFormat('en-US').format(stateRate) })
              : tx('x.stateRateMissing', { state: stateShown, rate: new Intl.NumberFormat('en-US').format(DEFAULT_SDG_RATE) })}
          </p>
        )}

        {file && (
          <p className="text-[11px] text-[#8a97ab] -mt-1 mb-0 truncate">
            {uploadingFile ? tx('x.uploading') : file.name}
            {tempFileKey && !uploadingFile ? ' · ready' : ''}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-500/10 border border-red-400/30 text-red-300 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={!ready || loading || uploadingFile}
        onClick={runOcr}
        className="app-action-primary !py-3 disabled:opacity-50"
      >
        {loading ? tx('x.extracting') : tx('x.extractReview')}
      </button>

      <button
        type="button"
        onClick={onBack}
        disabled={loading}
        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#8a97ab] hover:text-brand-orange"
      >
        <ChevronRight className="h-4 w-4 rotate-180" />
        {tx('x.back')}
      </button>
    </div>
  );
}
