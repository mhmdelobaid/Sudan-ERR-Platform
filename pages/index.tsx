import { useState, useEffect } from 'react';
import crypto from 'crypto';
import { useTranslation } from 'react-i18next';
import Calculator from '../components/calculator/Calculator';
import MainApp from './MainApp';
import { isUnlocked as wasUnlocked, setUnlocked, signOutAndLock } from '../services/appLock';

/**
 * Index.tsx
 * 
 * Home component shows calculator.
 */

const Home = () => {
  const { t } = useTranslation('home');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  // Check if we're coming from login/offline screens
  useEffect(() => {
    // Pages inside the app can only be reached after the calculator code, so the flag is enough.
    sessionStorage.removeItem('fromInternalPage');
    setIsUnlocked(wasUnlocked());
  }, []);

  // Sign out for real: ends the session, clears the login from the phone, back to the calculator.
  const handleLogout = () => {
    setIsUnlocked(false);
    signOutAndLock();
  };

  const handlePinEntry = (pin: string) => {
    if (doesEntryMatchHash(pin)) {
      setIsUnlocked(true);
      setUnlocked();
    } else {
      setIsLocked(true);
    }
  };

  const doesEntryMatchHash = (pin: string) => {
    try {
      const hash = crypto.createHash('sha256').update(pin, 'utf8').digest('hex');
      const calculatorPinHash = process.env.NEXT_PUBLIC_CALCULATOR_PIN;

      if (!calculatorPinHash) {
        throw new Error('Missing system hash needed for PIN')
      }
      return hash === calculatorPinHash;
    }
    catch(e) {
      console.log(e)
    }
  }

  if (isLocked) {
    return <div>{t('appLocked')}</div>;
  }

  return isUnlocked ? <MainApp onLogout={handleLogout} /> : <Calculator onPinEntry={handlePinEntry} />;
};

export default Home;