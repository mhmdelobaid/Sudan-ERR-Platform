// Links shown on the F-system hub and in Utilities: the user guide (in the app's language),
// the LCC website and the ERR website. Opened in a new tab.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ExternalLink, Globe } from 'lucide-react';

export const LCC_WEBSITE = 'https://lccsudan.org/';
export const ERR_WEBSITE = 'https://emergencyresponserooms.org/';

export default function QuickLinks() {
  const { t, i18n } = useTranslation('app');
  const guideHref = `/guides/user-guide-${i18n.language?.startsWith('en') ? 'en' : 'ar'}.pdf`;
  const links = [
    { href: guideHref, label: t('links.guide'), sub: t('links.guideSub'), Icon: BookOpen },
    { href: LCC_WEBSITE, label: t('links.lcc'), sub: 'lccsudan.org', Icon: ExternalLink },
    { href: ERR_WEBSITE, label: t('links.err'), sub: 'emergencyresponserooms.org', Icon: Globe },
  ];
  return (
    <section className="mt-6">
      <p className="app-section-label mb-2">{t('links.title')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {links.map(({ href, label, sub, Icon }) => (
          <a key={href} href={href} target="_blank" rel="noreferrer"
            className="app-panel flex items-center gap-3 px-4 py-3 hover:border-brand-orange/50 transition-colors">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#152238] text-brand-orange">
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white">{label}</span>
              <span className="block text-xs text-[#8a97ab] truncate" dir="ltr" style={{ textAlign: 'start' }}>{sub}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
