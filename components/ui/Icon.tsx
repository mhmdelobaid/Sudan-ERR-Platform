// components/ui/Icon.tsx
// The app's one icon set: Google Material Symbols, Rounded, weight 300 (shapes in ./iconPaths.ts, built in —
// no font or network request, so icons work offline and nothing is loaded from Google).
// Arrows and other direction icons flip automatically when the app is in Arabic.
//   <Icon name="arrow_back" />            decorative (hidden from screen readers)
//   <Icon name="print" title="Print" />   meaningful on its own (icon-only button)
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ICON_PATHS, IconName } from './iconPaths';

export type { IconName };

// Icons that point somewhere: mirrored for right-to-left
const DIRECTIONAL = new Set<IconName>([
    'arrow_back', 'arrow_forward', 'chevron_left', 'chevron_right', 'login', 'logout', 'send', 'skip_next', 'play_arrow',
]);

interface Props {
    name: IconName;
    size?: number;
    className?: string;
    title?: string;
}

const Icon: React.FC<Props> = ({ name, size = 20, className = '', title }) => {
    const { i18n } = useTranslation();
    const mirror = DIRECTIONAL.has(name) && (i18n.language || '').startsWith('ar');
    return (
        <svg
            viewBox="0 -960 960 960"
            width={size}
            height={size}
            fill="currentColor"
            className={`shrink-0 ${className}`}
            style={mirror ? { transform: 'scaleX(-1)' } : undefined}
            aria-hidden={title ? undefined : true}
            role={title ? 'img' : undefined}
            focusable="false"
        >
            {title && <title>{title}</title>}
            <path d={ICON_PATHS[name]} />
        </svg>
    );
};

export default Icon;
