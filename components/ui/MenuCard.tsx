// components/ui/MenuCard.tsx
// A main-menu card: ERR-blue icon, title and a one-line description, with the brand's orange accent strip.
import { FC, ReactNode } from 'react';

interface MenuCardProps {
    title: string;
    description?: string;
    icon: ReactNode;
    onClick: () => void;
    /** A small count in the corner (e.g. documents waiting for my signature). Hidden when 0 or missing. */
    badge?: number;
}

const MenuCard: FC<MenuCardProps> = ({ title, description, icon, onClick, badge }) => (
    <button
        type="button"
        onClick={onClick}
        className="relative group h-full w-full text-start bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-col gap-2
                   transition hover:shadow-md hover:border-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
    >
        <span aria-hidden="true" className="block w-10 h-1 rounded-full bg-brand-orange" />
        {!!badge && badge > 0 && (
            <span className="absolute top-3 end-3 min-w-[1.5rem] rounded-full bg-red-600 px-1.5 py-0.5 text-center text-xs font-bold text-white">{badge}</span>
        )}
        <span aria-hidden="true" className="flex items-center justify-center w-11 h-11 rounded-xl bg-green-50 text-brand-deep transition group-hover:bg-brand-blue group-hover:text-white">
            {icon}
        </span>
        <span className="font-bold text-gray-900 leading-snug">{title}</span>
        {description && <span className="text-xs text-gray-600 leading-relaxed">{description}</span>}
    </button>
);

export default MenuCard;
