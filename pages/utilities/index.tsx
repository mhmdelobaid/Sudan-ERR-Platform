import React from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import AppShell from '../../components/layout/AppShell';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { isRoomRole } from '../../services/me';
import QuickLinks from '../../components/layout/QuickLinks';
import { MessageSquare, WifiOff, UserCircle, UserCog, FolderKanban, Banknote } from 'lucide-react';

export default function UtilitiesPage() {
  const { t } = useTranslation('app');
  const { ready, role } = useRequireAuth();

  const items = [
    { href: '/profile', title: t('cards.profile.title'), desc: t('cards.profile.sub'), icon: UserCircle, accent: 'bg-surface-muted text-brand-deep', show: true },
    { href: '/user-management', title: t('cards.users.title'), desc: t('cards.users.sub'), icon: UserCog, accent: 'bg-surface-muted text-brand-deep', show: role === 'superadmin' },
    { href: '/projects-admin', title: t('cards.fundProjects.title'), desc: t('cards.fundProjects.sub'), icon: FolderKanban, accent: 'bg-surface-warm text-brand-darker', show: role === 'superadmin' },
    { href: '/state-rates', title: t('cards.rates.title'), desc: t('cards.rates.sub'), icon: Banknote, accent: 'bg-surface-muted text-brand-deep', show: role === 'admin' || role === 'superadmin' },
    { href: '/feedback', title: t('cards.feedback.title'), desc: t('cards.feedback.sub'), icon: MessageSquare, accent: 'bg-surface-muted text-brand-deep', show: true },
    { href: '/offline-mode', title: t('cards.offline.title'), desc: t('cards.offline.sub'), icon: WifiOff, accent: 'bg-surface-warm text-brand-darker', show: isRoomRole(role) },
  ].filter((i) => i.show);

  return (
    <AppShell title={t('home.utilities')}>
      {!ready ? (
        <p className="text-[#a8b6cc] text-sm">{t('common.loading')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="app-panel flex flex-col items-center justify-center gap-3 p-5 min-h-[8rem] text-center hover:shadow-lift hover:border-brand-orange/40 transition-all"
              >
                <span className={`rounded-2xl p-3 ${item.accent}`}>
                  <Icon className="h-6 w-6" />
                </span>
                <span>
                  <span className="block font-bold text-white text-sm">{item.title}</span>
                  <span className="block text-[11px] text-[#a8b6cc] mt-1">{item.desc}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
      <QuickLinks />
    </AppShell>
  );
}
