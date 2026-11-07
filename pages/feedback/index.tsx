import React from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import AppShell from '../../components/layout/AppShell';
import FeedbackForm from '../../components/forms/FeedbackForm';
import { useRequireAuth } from '../../hooks/useRequireAuth';

export default function FeedbackPage() {
  const { ready } = useRequireAuth();
  const { t } = useTranslation('app');
  const router = useRouter();

  if (!ready) {
    return (
      <AppShell title={t('cards.feedback.title')}>
        <p className="text-[#a8b6cc] text-sm">{t('common.loading')}</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={t('cards.feedback.title')}>
      <div className="rounded-2xl bg-white p-4 text-gray-900">
        <FeedbackForm onReturnToMenu={() => router.push('/home')} />
      </div>
    </AppShell>
  );
}
