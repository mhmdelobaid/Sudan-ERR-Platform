import { useState, useEffect } from 'react';
import crypto from 'crypto';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import Calculator from '../components/calculator/Calculator';
import { isUnlocked as wasUnlocked, setUnlocked } from '../services/appLock';

/**
 * The calculator disguise. The right code (then "=") unlocks the app and opens /login, which is also the
 * landing screen (sign in, offline mode, user guide). Signing out (services/appLock.ts signOutAndLock)
 * clears the session and the unlock, and brings the person back here.
 */

const Home = () => {
  const { t } = useTranslation('home');
  const router = useRouter();
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Pages inside the app can only be reached after the calculator code, so the unlock flag is enough
    // (a "came from inside the app" flag must never unlock it).
    sessionStorage.removeItem('fromInternalPage');
    setIsUnlocked(wasUnlocked());
    setChecking(false);
  }, []);

  useEffect(() => {
    if (!checking && isUnlocked) {
      router.replace('/login');
    }
  }, [checking, isUnlocked, router]);

  const handlePinEntry = (pin: string) => {
    if (doesEntryMatchHash(pin)) {
      setUnlocked();
      setIsUnlocked(true);
    } else {
      setIsLocked(true);
    }
  };

  const doesEntryMatchHash = (pin: string) => {
    try {
      const hash = crypto.createHash('sha256').update(pin, 'utf8').digest('hex');
      const calculatorPinHash = process.env.NEXT_PUBLIC_CALCULATOR_PIN;

      if (!calculatorPinHash) {
        throw new Error('Missing system hash needed for PIN');
      }
      return hash === calculatorPinHash;
    } catch (e) {
      console.log(e);
      return false;
    }
  };

  if (isLocked) {
    return <div>{t('appLocked')}</div>;
  }

  if (checking || isUnlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center app-page-bg" aria-busy="true" />
    );
  }

  return (
    <>
      <Head>
        <title>Calculator</title>
      </Head>
      <Calculator onPinEntry={handlePinEntry} />
    </>
  );
};

export default Home;
