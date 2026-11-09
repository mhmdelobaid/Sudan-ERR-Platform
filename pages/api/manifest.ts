// Web app manifest with the name and icon this phone chose (lib/appLook.ts). No login: it holds no data.
import type { NextApiRequest, NextApiResponse } from 'next';
import { APP_LOOK_ICONS, AppLookIcon, cleanAppName, DEFAULT_APP_LOOK, iconUrl } from '../../lib/appLook';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const iconParam = String(req.query.icon || '');
  const icon: AppLookIcon = (APP_LOOK_ICONS as readonly string[]).includes(iconParam)
    ? (iconParam as AppLookIcon)
    : DEFAULT_APP_LOOK.icon;
  const name = cleanAppName(String(req.query.name || '')) || DEFAULT_APP_LOOK.name;
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    name,
    short_name: name,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#000000',
    icons: [
      { src: iconUrl(icon, 192), sizes: '192x192', type: 'image/png' },
      { src: iconUrl(icon, 512), sizes: '512x512', type: 'image/png' },
    ],
  });
}
