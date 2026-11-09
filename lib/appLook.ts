// How the app appears when added to a phone's home screen: its name and icon.
// Chosen per phone (saved in this browser only) so the installed app looks like an ordinary tool.
// Applied before the person taps "Add to Home Screen" (iPhone reads the page's tags; Android reads the manifest).
export const APP_LOOK_ICONS = ['calculator', 'converter', 'notes', 'tools'] as const;
export type AppLookIcon = (typeof APP_LOOK_ICONS)[number];
export type AppLook = { icon: AppLookIcon; name: string };

const KEY = 'app_look';
export const DEFAULT_APP_LOOK: AppLook = { icon: 'calculator', name: 'Calculator' };

export function cleanAppName(name: string): string {
  return (name || '').replace(/[<>"'`\\]/g, '').trim().slice(0, 30);
}

export function readAppLook(): AppLook {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_APP_LOOK;
    const v = JSON.parse(raw);
    const icon = APP_LOOK_ICONS.includes(v?.icon) ? v.icon : DEFAULT_APP_LOOK.icon;
    return { icon, name: cleanAppName(v?.name) || DEFAULT_APP_LOOK.name };
  } catch {
    return DEFAULT_APP_LOOK;
  }
}

export function saveAppLook(look: AppLook) {
  const clean = { icon: look.icon, name: cleanAppName(look.name) || DEFAULT_APP_LOOK.name };
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* private mode: still applied for this visit */
  }
  applyAppLook(clean);
}

function setHead(selector: string, create: () => HTMLElement, attr: string, value: string) {
  let el = document.head.querySelector(selector) as HTMLElement | null;
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

export function iconUrl(icon: AppLookIcon, size: 180 | 192 | 512) {
  return `/icons/disguise/${icon}-${size}.png`;
}

export function applyAppLook(look: AppLook = readAppLook()) {
  if (typeof document === 'undefined') return;
  const link = (rel: string) => () => {
    const l = document.createElement('link');
    l.rel = rel;
    return l;
  };
  const meta = (name: string) => () => {
    const m = document.createElement('meta');
    m.name = name;
    return m;
  };
  const q = `icon=${encodeURIComponent(look.icon)}&name=${encodeURIComponent(look.name)}`;
  setHead('link[rel="manifest"]', link('manifest'), 'href', `/api/manifest?${q}`);
  setHead('link[rel="apple-touch-icon"]', link('apple-touch-icon'), 'href', iconUrl(look.icon, 180));
  setHead('link[rel="icon"]', link('icon'), 'href', iconUrl(look.icon, 192));
  setHead('meta[name="apple-mobile-web-app-title"]', meta('apple-mobile-web-app-title'), 'content', look.name);
  setHead('meta[name="application-name"]', meta('application-name'), 'content', look.name);
}
