import React from 'react';
import { useTranslation } from 'react-i18next';
import AppShell from '../../components/layout/AppShell';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { HomeSection, HomeCard } from '../../components/home/HomeSection';
import {
  WorkPlanScene,
  ApprovalsScene,
  MouScene,
  ReportingScene,
} from '../../components/home/illustrations';

/** The F-System forms, in order: F1 work plan, F2 screening, F3 contract, F4 & F5 reports. */
export default function FSystemHubPage() {
  const { t } = useTranslation('app');
  const { ready, role } = useRequireAuth();
  const canScreen = role === 'state_rep' || role === 'admin' || role === 'superadmin';

  if (!ready) {
    return (
      <AppShell title={t('nav.fsystem')}>
        <p className="text-[#a8b6cc] text-sm">{t('common.loading')}</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={t('nav.fsystem')}>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white leading-snug mb-1">{t('fsystem.heading')}</h2>
        <p className="text-sm text-[#a8b6cc] mb-0">{t('fsystem.intro')}</p>
      </div>

      <HomeSection title={t('fsystem.forms')} href="/f-system">
        <HomeCard href="/f-system/f1" code="F1" title={t('cards.f1.title')} subtitle={t('cards.f1.sub')}
          illustration={WorkPlanScene} wash="bg-brand-orangeSoft" size="md" />
        <HomeCard href={canScreen ? '/f2-review' : '/f-system/f1?view=status'} code="F2" title={t('cards.f2.title')}
          subtitle={canScreen ? t('cards.f2.sub') : t('cards.f2.subRoom')}
          illustration={ApprovalsScene} wash="bg-[#9BB0D4]" size="md" />
        <HomeCard href="/f3-contracts" code="F3" title={t('cards.f3.title')} subtitle={t('cards.f3.sub')}
          illustration={MouScene} wash="bg-[#BCCBE3]" size="md" />
        <HomeCard href="/f-system/f4-f5" code="F4 & F5" title={t('cards.f4f5.title')} subtitle={t('cards.f4f5.sub')}
          illustration={ReportingScene} wash="bg-[#7B96C4]" size="md" />
      </HomeSection>
    </AppShell>
  );
}
