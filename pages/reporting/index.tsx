import { useEffect } from 'react';
import { useRouter } from 'next/router';

/** Legacy route — redirects to F4 & F5 Reporting under F-System */
export default function ReportingRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/f-system/f4-f5');
  }, [router]);
  return (
    <div className="min-h-screen app-page-bg" aria-busy="true" />
  );
}
