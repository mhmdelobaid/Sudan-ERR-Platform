import { useEffect } from 'react';
import { useRouter } from 'next/router';

/** Legacy route — redirects to F1 Work Plans under F-System */
export default function ProjectsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/f-system/f1');
  }, [router]);
  return (
    <div className="min-h-screen app-page-bg" aria-busy="true" />
  );
}
