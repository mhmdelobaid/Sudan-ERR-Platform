// Link to a project's file (F1 to F5, printable as one PDF): /project-file?id=<id>
import React from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

export default function ProjectFileLink({ projectId, className = '' }: { projectId: string; className?: string }) {
    const { t } = useTranslation('projectFile');
    return (
        <Link href={`/project-file?id=${encodeURIComponent(projectId)}`} onClick={e => e.stopPropagation()}
            className={`inline-flex items-center gap-1 rounded-lg border border-brand-blue/50 bg-white px-3 py-1.5 text-xs font-semibold text-brand-blue hover:bg-blue-50 ${className}`}>
            <span aria-hidden="true">📄</span> {t('open')}
        </Link>
    );
}
