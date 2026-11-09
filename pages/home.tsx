import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import AppShell from '../components/layout/AppShell';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { HomeSection, HomeCard } from '../components/home/HomeSection';
import {
  WorkPlanScene,
  ApprovalsScene,
  MouScene,
  ReportingScene,
  DashboardScene,
  FeedbackScene,
  OfflineScene,
} from '../components/home/illustrations';
import { isRoomRole } from '../services/me';
import { newSupabase } from '../services/newSupabaseClient';
import { fetchMySignatures } from '../components/signatures/signApi';
import { cacheForOffline, sealWaitingReports } from '../services/offlineReports';
import { fetchSealKey } from '../services/offlineCrypto';
import { sendQueuedReports } from '../services/offlineSync';

/**
 * Home after sign-in. Each role sees what it uses:
 * - rooms (base, locality, state) and admins: F1, F3, F4 & F5, signatures (officers), offline mode
 * - state representatives: F2 screening
 * - Project Working Group members: the projects their group runs
 * - superadmin: everything, plus user management
 */
export default function HomePage() {
  const { t } = useTranslation('app');
  const router = useRouter();
  const { ready, role } = useRequireAuth();
  const [signatures, setSignatures] = useState<{ position: string | null; waiting: number } | null>(null);

  const room = isRoomRole(role);
  const isAdmin = role === 'admin' || role === 'superadmin';

  // Offline mode: keep this person's projects and the expense types on the phone, load the offline page's code
  // now so it opens later with no network, and send any F4 reports saved offline. Never blocks the page.
  useEffect(() => {
    if (!ready || !room) return;
    let cancelled = false;
    router.prefetch('/offline-mode').catch(() => {});
    (async () => {
      try {
        const { data: { session } } = await newSupabase.auth.getSession();
        if (!session || cancelled) return;
        const [projRes, catRes] = await Promise.all([
          fetch('/api/get-projects', { headers: { Authorization: `Bearer ${session.access_token}` } }).then((r) => r.json()),
          newSupabase.from('expense_categories').select('expense_name, language'),
        ]);
        if (cancelled || !projRes?.success) return;
        const names = (catRes.data || [])
          .filter((c: any) => !c.language || c.language === 'en')
          .map((c: any) => String(c.expense_name || '').trim())
          .filter(Boolean);
        cacheForOffline(session.user.id, projRes.projects || [], Array.from(new Set(names)));
        // The key offline reports are sealed with on this phone; then seal anything still kept readable
        if (await fetchSealKey(session.access_token)) await sealWaitingReports();
      } catch { /* offline mode keeps the list saved last time */ }
      if (!cancelled) sendQueuedReports().catch(() => {});
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, room]);

  // Documents waiting for my signature (room officers only)
  useEffect(() => {
    if (!ready || !room) return;
    fetchMySignatures()
      .then((d) => setSignatures({ position: d.me?.officer_position || null, waiting: (d.queue || []).length }))
      .catch(() => setSignatures(null));
  }, [ready, room]);

  if (!ready) {
    return (
      <AppShell title={t('home.title')}>
        <p className="text-[#a8b6cc] text-sm">{t('common.loading')}</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={t('home.title')}>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white leading-snug mb-1">{t('home.heading')}</h2>
        <p className="text-sm text-[#a8b6cc] mb-0">
          {role === 'state_rep' ? t('home.introStateRep') : role === 'lcc_wg' ? t('home.introWg') : t('home.intro')}
        </p>
      </div>

      {(room || isAdmin) && (
        <HomeSection title={t('home.fsystem')} href="/f-system">
          <HomeCard href="/f-system/f1" code="F1" title={t('cards.f1.title')} subtitle={t('cards.f1.sub')}
            illustration={WorkPlanScene} wash="bg-brand-orangeSoft" />
          {isAdmin && (
            <HomeCard href="/f2-review" code="F2" title={t('cards.f2.title')} subtitle={t('cards.f2.subAdmin')}
              illustration={ApprovalsScene} wash="bg-[#9BB0D4]" />
          )}
          <HomeCard href="/f3-contracts" code="F3" title={t('cards.f3.title')} subtitle={t('cards.f3.sub')}
            illustration={MouScene} wash="bg-[#BCCBE3]" />
          <HomeCard href="/f-system/f4-f5" code="F4 & F5" title={t('cards.f4f5.title')} subtitle={t('cards.f4f5.sub')}
            illustration={ReportingScene} wash="bg-[#7B96C4]" />
          {signatures?.position && (
            <HomeCard href="/signatures" title={t('cards.signatures.title')} subtitle={t('cards.signatures.sub')}
              badge={signatures.waiting} illustration={ApprovalsScene} wash="bg-brand-orangeSoft" />
          )}
        </HomeSection>
      )}

      {role === 'state_rep' && (
        <HomeSection title={t('home.screening')} href="/f2-review">
          <HomeCard href="/f2-review" code="F2" title={t('cards.f2.title')} subtitle={t('cards.f2.sub')}
            illustration={ApprovalsScene} wash="bg-[#9BB0D4]" size="md" />
        </HomeSection>
      )}

      {(role === 'lcc_wg' || role === 'superadmin') && (
        <HomeSection title={t('home.workingGroup')} href="/wg-projects">
          <HomeCard href="/wg-projects" title={t('cards.wg.title')} subtitle={t('cards.wg.sub')}
            illustration={WorkPlanScene} wash="bg-[#BCCBE3]" size="md" />
          {role === 'superadmin' && (
            <HomeCard href="/projects-admin" title={t('cards.fundProjects.title')} subtitle={t('cards.fundProjects.sub')}
              illustration={ApprovalsScene} wash="bg-brand-orangeSoft" size="md" />
          )}
        </HomeSection>
      )}

      <HomeSection title={t('home.dashboard')} href="/dashboard">
        <HomeCard href="/dashboard" title={t('cards.dashboard.title')} subtitle={t('cards.dashboard.sub')}
          illustration={DashboardScene} wash="bg-[#5D7EB3]" />
      </HomeSection>

      <HomeSection title={t('home.utilities')} href="/utilities">
        <HomeCard href="/profile" title={t('cards.profile.title')} subtitle={t('cards.profile.sub')}
          illustration={FeedbackScene} wash="bg-[#9BB0D4]" />
        {role === 'superadmin' && (
          <HomeCard href="/user-management" title={t('cards.users.title')} subtitle={t('cards.users.sub')}
            illustration={DashboardScene} wash="bg-[#BCCBE3]" />
        )}
        <HomeCard href="/feedback" title={t('cards.feedback.title')} subtitle={t('cards.feedback.sub')}
          illustration={FeedbackScene} wash="bg-[#4A6798]" />
        {room && (
          <HomeCard href="/offline-mode" title={t('cards.offline.title')} subtitle={t('cards.offline.sub')}
            illustration={OfflineScene} wash="bg-brand-orangeSoft" />
        )}
      </HomeSection>
    </AppShell>
  );
}
