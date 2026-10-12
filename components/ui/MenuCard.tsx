// components/ui/MenuCard.tsx
// A main-menu card: ERR-blue icon, title and a one-line description, with the brand's orange accent strip.
import { FC, ReactNode } from 'react';

interface MenuCardProps {
    title: string;
    description?: string;
    icon: ReactNode;
    onClick: () => void;
}

const MenuCard: FC<MenuCardProps> = ({ title, description, icon, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className="group h-full w-full text-start bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-col gap-2
                   transition hover:shadow-md hover:border-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
    >
        <span aria-hidden="true" className="block w-10 h-1 rounded-full bg-brand-orange" />
        <span aria-hidden="true" className="flex items-center justify-center w-11 h-11 rounded-xl bg-green-50 text-brand-deep transition group-hover:bg-brand-blue group-hover:text-white">
            {icon}
        </span>
        <span className="font-bold text-gray-900 leading-snug">{title}</span>
        {description && <span className="text-xs text-gray-600 leading-relaxed">{description}</span>}
    </button>
);

export default MenuCard;
