// My account: the name and icon this phone shows when the app is added to the home screen.
// A safety option: an installed app that looks like an ordinary tool draws less attention at a checkpoint.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_LOOK_ICONS, AppLook, DEFAULT_APP_LOOK, iconUrl, readAppLook, saveAppLook } from '../../lib/appLook';

export default function AppLookSettings({ cardClass }: { cardClass: string }) {
  const { t } = useTranslation('app');
  const [look, setLook] = useState<AppLook>(DEFAULT_APP_LOOK);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setLook(readAppLook()); }, []);

  const save = () => {
    saveAppLook(look);
    setLook(readAppLook());
    setSaved(true);
  };

  return (
    <section className={cardClass} aria-labelledby="sec-look">
      <h2 id="sec-look" className="text-base font-bold text-gray-900 mb-0">{t('look.title')}</h2>
      <p className="text-sm text-gray-600 mb-0">{t('look.intro')}</p>

      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t('look.icon')}>
        {APP_LOOK_ICONS.map((icon) => (
          <button key={icon} type="button" role="radio" aria-checked={look.icon === icon}
            onClick={() => { setLook({ ...look, icon }); setSaved(false); }}
            className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-xs font-semibold ${look.icon === icon ? 'border-brand-blue ring-2 ring-brand-blue/30 text-gray-900' : 'border-gray-200 text-gray-600'}`}>
            <img src={iconUrl(icon, 180)} alt="" className="h-12 w-12 rounded-xl" />
            {t(`look.icons.${icon}`)}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="block text-sm font-semibold text-gray-800 mb-1">{t('look.name')}</span>
        <input type="text" maxLength={30} value={look.name}
          onChange={(e) => { setLook({ ...look, name: e.target.value }); setSaved(false); }}
          placeholder={t('look.namePlaceholder')}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 bg-white" dir="auto" />
      </label>

      <div className="flex items-center justify-between gap-3">
        {saved ? <p className="text-sm text-emerald-700 mb-0" role="status">{t('look.saved')}</p> : <span />}
        <button type="button" onClick={save}
          className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white">{t('look.save')}</button>
      </div>
      <p className="text-xs text-gray-500 mb-0">{t('look.howTo')}</p>
    </section>
  );
}
