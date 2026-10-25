// Shows a page only after the calculator code was entered in this tab (security audit H1).
// Anyone who opens /menu, /dashboard or any other page directly is sent to the calculator.
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { isOpenPath, isUnlocked } from '../services/appLock';

const LockGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const router = useRouter();
    const open = isOpenPath(router.pathname);
    const [allowed, setAllowed] = useState(open);

    useEffect(() => {
        if (open) { setAllowed(true); return; }
        if (isUnlocked()) { setAllowed(true); return; }
        setAllowed(false);
        router.replace('/');
    }, [open, router, router.pathname]);

    // Nothing of the page is drawn (not even for a moment) until the check has passed.
    if (!allowed) return <div className="min-h-screen bg-gray-100" aria-hidden="true" />;
    return <>{children}</>;
};

export default LockGate;
