import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getMe, type Me } from '../services/me';

/** Pages inside the app: sends anyone not signed in (or without access) to the sign-in page. */
export function useRequireAuth() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then(({ me, token }) => {
        if (cancelled) return;
        if (!me || !token) {
          router.replace('/login');
          return;
        }
        setMe(me);
        setToken(token);
        setReady(true);
      })
      .catch(() => { if (!cancelled) router.replace('/login'); });
    return () => { cancelled = true; };
  }, [router]);

  return { ready, token, me, role: me?.role ?? null };
}
