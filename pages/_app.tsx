//pages/_app.tsx
import { useEffect } from 'react';
import Head from 'next/head';
import '../styles/globals.css';
import { registerServiceWorker } from '../services/serviceWorkerRegistration';
import { sendQueuedReports } from '../services/offlineSync';
import { appWithTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import i18n from '../services/i18n'; // Import i18n initialization
import LockGate from '../components/LockGate';

function MyApp({ Component, pageProps }) {
  const router = useRouter();

  // Register the service worker and setup online/offline event listeners
  useEffect(() => {
    console.log('Initializing service worker and network event listeners.');

    // Register service worker
    registerServiceWorker();

    // F4 reports saved in offline mode are sent when the phone comes back online, and once when the app
    // opens online (services/offlineSync.ts). They need a signed-in person; until then they wait on the phone.
    const sendSaved = () => { sendQueuedReports().catch(() => { /* shown in offline mode */ }); };
    const onOnline = () => {
      console.log('Network connectivity restored. Sending reports saved offline.');
      sendSaved();
    };
    const firstTry = window.setTimeout(() => { if (navigator.onLine) sendSaved(); }, 4000);

    const onOffline = () => {
      console.log('App is now offline. Queued submissions will sync when online.');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Cleanup event listeners on unmount
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearTimeout(firstTry);
    };
  }, []);

  // Update document attributes based on locale
  useEffect(() => {
    console.log(`Setting language and direction attributes for locale: ${router.locale}`);

    const dir = router.locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', router.locale || 'en');

    // Synchronize i18next with Next.js locale
    if (router.locale) {
      i18n.changeLanguage(router.locale).then(() => {
        console.log(`Language successfully changed to ${router.locale}`);
      }).catch((error) => {
        console.error('Error changing language:', error);
      });
    }
  }, [router.locale]);

  // Render the application
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
      </Head>
      <LockGate>
        <Component {...pageProps} />
      </LockGate>
    </>
  );
}

export default appWithTranslation(MyApp);
