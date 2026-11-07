// The thin bar at the top of the app: shown when there's no internet, or when F4 reports saved in offline mode
// are waiting to be sent (services/offlineReports.ts). "Send now" uses the same sender as offline mode.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { unsentReports, CHANGED_EVENT } from '../../services/offlineReports';
import { sendQueuedReports } from '../../services/offlineSync';

const OfflineStatusIndicator: React.FC = () => {
  const { t } = useTranslation('app');
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);
  const [failed, setFailed] = useState(0);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(() => {
    try {
      const list = unsentReports();
      setWaiting(list.length);
      setFailed(list.filter((r) => r.status === 'failed').length);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    refresh();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  if (online && waiting === 0) return null;

  const sendNow = () => {
    setSending(true);
    sendQueuedReports().catch(() => {}).finally(() => { setSending(false); refresh(); });
  };

  return (
    <div
      className={`text-xs sm:text-sm px-4 py-2 flex items-center justify-between gap-2 font-medium ${
        !online ? 'bg-red-600 text-white' : failed ? 'bg-brand-orange text-ink' : 'bg-brand-deep text-white'
      }`}
    >
      <span>
        {!online
          ? t('offlineBar.offline', { count: waiting })
          : sending
            ? t('offlineBar.sending', { count: waiting })
            : failed
              ? t('offlineBar.failed', { failed, count: waiting })
              : t('offlineBar.waiting', { count: waiting })}
      </span>
      <span className="flex items-center gap-3 shrink-0">
        {online && waiting > 0 && !sending && (
          <button type="button" className="underline font-semibold" onClick={sendNow}>
            {t('offlineBar.sendNow')}
          </button>
        )}
        <Link href="/offline-mode" className="underline font-semibold">
          {t('offlineBar.open')}
        </Link>
      </span>
    </div>
  );
};

export default OfflineStatusIndicator;
