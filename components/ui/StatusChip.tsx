// One project-status pill, the same on every screen (see services/responseStatus.ts)
import React from 'react';
import { useTranslation } from 'react-i18next';
import { STATUS_STYLE, toResponseStatus } from '../../services/responseStatus';

export default function StatusChip({ status, className = '' }: { status: string | null | undefined; className?: string }) {
    const { t } = useTranslation('status');
    const s = toResponseStatus(status);
    const style = STATUS_STYLE[s];
    return (
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${className}`}
              style={{ background: style.bg, color: style.fg }} title={t(`hint.${s}`)}>
            {t(s)}
        </span>
    );
}
