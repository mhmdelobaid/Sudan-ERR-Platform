import React, { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import {
  Home,
  Layers,
  BarChart3,
  WifiOff,
  Monitor,
  Smartphone,
  LogOut,
  Vote,
  Users,
  UserCircle,
  Languages,
} from 'lucide-react';
import { useLayoutPreference } from '../../hooks/useLayoutPreference';
import OfflineStatusIndicator from './OfflineStatusIndicator';
import UpdateBanner from './UpdateBanner';
import { signOutAndLock } from '../../services/appLock';
import { getMe, isRoomRole } from '../../services/me';
import i18n from '../../services/i18n';

const LogoImage = '/brand/err-logo.png';

type NavItem = {
  href: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: (pathname: string) => boolean;
  sub?: { href: string; labelKey: string }[];
};

/** The bottom bar (phones) / side bar (computers). Each role sees what it uses. */
function navFor(role: string | null): NavItem[] {
  const home: NavItem = { href: '/home', labelKey: 'nav.home', icon: Home };
  const dashboard: NavItem = { href: '/dashboard', labelKey: 'nav.dashboard', icon: BarChart3 };
  if (role === 'state_rep') {
    return [home, { href: '/f2-review', labelKey: 'nav.f2', icon: Vote }, dashboard];
  }
  if (role === 'lcc_wg') {
    return [home, { href: '/wg-projects', labelKey: 'nav.wg', icon: Users }, dashboard];
  }
  const fsystem: NavItem = {
    href: '/f-system',
    labelKey: 'nav.fsystem',
    icon: Layers,
    match: (p) =>
      p.startsWith('/f-system') || p.startsWith('/projects') || p.startsWith('/reporting') ||
      p.startsWith('/f2-review') || p.startsWith('/f3-contracts') || p.startsWith('/signatures'),
    sub: [
      { href: '/f-system/f1', labelKey: 'nav.f1' },
      ...(role === 'admin' || role === 'superadmin' ? [{ href: '/f2-review', labelKey: 'nav.f2' }] : []),
      { href: '/f3-contracts', labelKey: 'nav.f3' },
      { href: '/f-system/f4-f5', labelKey: 'nav.f4f5' },
    ],
  };
  // While the role is still loading, show the room set (the most common)
  if (!role || isRoomRole(role)) {
    return [home, fsystem, dashboard, { href: '/offline-mode', labelKey: 'nav.offline', icon: WifiOff }];
  }
  return [home, dashboard];
}

function isActive(item: NavItem, pathname: string) {
  if (item.match) return item.match(pathname);
  return pathname === item.href;
}

type AppShellProps = {
  children: ReactNode;
  title?: string;
  bare?: boolean;
};

const AppShell: React.FC<AppShellProps> = ({ children, title, bare }) => {
  const router = useRouter();
  const { t } = useTranslation('app');
  const { layout, setLayout, ready } = useLayoutPreference();
  const isDesktop = ready && layout === 'desktop';
  const [role, setRole] = useState<string | null>(null);
  const isAr = (i18n.language || 'ar').startsWith('ar');

  useEffect(() => {
    let cancelled = false;
    getMe().then(({ me }) => { if (!cancelled) setRole(me?.role ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const nav = navFor(role);

  const switchLanguage = async () => {
    const next = isAr ? 'en' : 'ar';
    await i18n.changeLanguage(next);
    router.push(router.pathname, router.asPath, { locale: next });
  };

  if (bare) {
    return <>{children}</>;
  }

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className={`min-h-screen app-page-bg print:bg-white flex ${
        isDesktop ? 'flex-row app-shell--desktop' : 'flex-col app-shell--mobile'
      }`}
    >
      {isDesktop && (
        <aside className="print:hidden w-64 shrink-0 bg-[#152238]/95 backdrop-blur-sm border-e border-white/10 flex flex-col sticky top-0 h-screen">
          <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
            <div className="h-10 w-10 rounded-2xl bg-white flex items-center justify-center overflow-hidden">
              <img src={LogoImage} alt="ERR" className="h-8 w-8 object-contain" />
            </div>
            <div>
              <p className="font-bold text-white text-sm leading-tight">{t('shell.appName')}</p>
              <p className="text-[11px] text-[#8a97ab] mb-0">{t('shell.tagline')}</p>
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            <p className="app-section-label px-3 mb-2 mt-1">{t('shell.navigate')}</p>
            {[...nav, { href: '/profile', labelKey: 'nav.profile', icon: UserCircle } as NavItem].map((item) => {
              const Icon = item.icon;
              const active = isActive(item, router.pathname);
              const hasSub = !!item.sub;
              return (
                <div key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                      active && !hasSub
                        ? 'bg-brand-orange text-[#152238] shadow-soft'
                        : active && hasSub
                          ? 'bg-white/10 text-brand-orange'
                          : 'text-[#a8b6cc] hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0 opacity-90" />
                    {t(item.labelKey)}
                  </Link>
                  {item.sub && (
                    <div className="ms-4 mt-0.5 mb-1 space-y-0.5 border-s border-white/10 ps-2">
                      {item.sub.map((sub) => {
                        const subActive = router.pathname.startsWith(sub.href);
                        return (
                          <Link
                            key={sub.href}
                            href={sub.href}
                            className={`block rounded-lg px-3 py-2 text-xs font-semibold ${
                              subActive
                                ? 'bg-brand-orange text-[#152238]'
                                : 'text-[#8a97ab] hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            {t(sub.labelKey)}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <div className="p-3 border-t border-white/10 space-y-1">
            <button
              type="button"
              onClick={() => setLayout('mobile')}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[#a8b6cc] hover:bg-white/5"
            >
              <Smartphone className="h-4 w-4" />
              {t('shell.mobileLayout')}
            </button>
            <button
              type="button"
              onClick={() => signOutAndLock()}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[#a8b6cc] hover:bg-white/5"
            >
              <LogOut className="h-4 w-4" />
              {t('shell.logout')}
            </button>
          </div>
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <div className="print:hidden">
          <OfflineStatusIndicator />
        </div>

        <header className="print:hidden sticky top-0 z-40 bg-[#152238]/90 backdrop-blur-md border-b border-white/10 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {!isDesktop && (
              <div className="h-9 w-9 rounded-xl bg-white flex items-center justify-center shrink-0">
                <img src={LogoImage} alt="" className="h-7 w-7 object-contain" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-bold text-white truncate text-base sm:text-lg leading-tight mb-0">
                {title || t('shell.appName')}
              </h1>
              {!isDesktop && (
                <p className="text-[11px] text-[#8a97ab] truncate mb-0">{t('shell.workspace')}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={switchLanguage}
              title={t('shell.language')}
              className="flex items-center gap-1 rounded-xl bg-white/10 px-2.5 py-2 text-xs font-semibold text-[#e8eef8] hover:bg-white/15"
            >
              <Languages className="h-4 w-4" />
              {isAr ? 'English' : 'العربية'}
            </button>
            <div className="hidden sm:flex items-center gap-1 rounded-xl bg-white/10 p-0.5">
              <button
                type="button"
                title={t('shell.mobileLayout')}
                onClick={() => setLayout('mobile')}
                className={`p-2 rounded-lg transition-colors ${
                  !isDesktop ? 'bg-brand-orange text-[#152238] shadow-soft' : 'text-[#8a97ab] hover:text-white'
                }`}
              >
                <Smartphone className="h-4 w-4" />
              </button>
              <button
                type="button"
                title={t('shell.desktopLayout')}
                onClick={() => setLayout('desktop')}
                className={`p-2 rounded-lg transition-colors ${
                  isDesktop ? 'bg-brand-orange text-[#152238] shadow-soft' : 'text-[#8a97ab] hover:text-white'
                }`}
              >
                <Monitor className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <main
          className={`flex-1 w-full mx-auto animate-fade-up print:max-w-none print:p-0 ${
            isDesktop ? 'max-w-6xl px-6 py-6' : 'max-w-lg px-4 py-5 pb-28'
          }`}
        >
          {children}
        </main>

        {!isDesktop && (
          <nav className="print:hidden fixed bottom-0 inset-x-0 z-40 bg-[#152238]/95 backdrop-blur-md border-t border-white/10 flex px-0.5 pb-[env(safe-area-inset-bottom)]">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item, router.pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2.5 text-[10px] font-semibold ${
                    active ? 'text-brand-orange' : 'text-[#8a97ab]'
                  }`}
                >
                  <span className={`rounded-xl p-1.5 ${active ? 'bg-brand-orange text-[#152238] shadow-soft' : ''}`}>
                    <Icon className={`h-5 w-5 ${active ? 'text-[#152238]' : ''}`} />
                  </span>
                  <span className="truncate max-w-full px-0.5">{t(item.labelKey)}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => signOutAndLock()}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2.5 text-[10px] font-semibold text-[#8a97ab]"
            >
              <span className="rounded-xl p-1.5">
                <LogOut className="h-5 w-5" />
              </span>
              <span>{t('shell.logout')}</span>
            </button>
          </nav>
        )}
      </div>

      <div className="print:hidden">
        <UpdateBanner />
      </div>
    </div>
  );
};

export default AppShell;
