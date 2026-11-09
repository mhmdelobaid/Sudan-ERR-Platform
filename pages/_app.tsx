import { useEffect } from 'react';
import Head from 'next/head';
import '../styles/globals.css';
import {
  registerServiceWorker,
  onServiceWorkerUpdate,
} from '../services/serviceWorkerRegistration';
import { sendQueuedReports } from '../services/offlineSync';
import { appWithTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import i18n from '../services/i18n'; // Import i18n initialization
import LockGate from '../components/LockGate';
import { applyAppLook } from '../lib/appLook';

function MyApp({ Component, pageProps }) {
  // Home-screen name and icon chosen on this phone (My account)
  useEffect(() => { applyAppLook(); }, []);
  const router = useRouter();

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      onServiceWorkerUpdate(() => {
        window.dispatchEvent(new CustomEvent('swUpdateAvailable'));
      });
      registerServiceWorker();
    } else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      if ('caches' in window) {
        caches.keys().then((names) => names.forEach((name) => caches.delete(name)));
      }
    }

    // F4 reports saved in offline mode are sent when the phone comes back online, and once when the app
    // opens online (services/offlineSync.ts). They need a signed-in person; until then they wait on the phone.
    const sendSaved = () => { sendQueuedReports().catch(() => { /* shown in offline mode */ }); };
    const onOnline = () => {
      console.log('Network connectivity restored. Sending reports saved offline.');
      sendSaved();
    };
    const firstTry = window.setTimeout(() => { if (navigator.onLine) sendSaved(); }, 4000);

    window.addEventListener('online', onOnline);
    // Cleanup event listeners on unmount
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearTimeout(firstTry);
    };
  }, []);

  useEffect(() => {
    const dir = router.locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', router.locale || 'en');

    if (router.locale) {
      i18n.changeLanguage(router.locale).catch(() => {});
    }
  }, [router.locale]);

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0"
        />
      </Head>
      <LockGate>
        <Component {...pageProps} />
      </LockGate>
    </>
  );
}

export default appWithTranslation(MyApp);
