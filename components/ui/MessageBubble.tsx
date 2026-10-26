// components/MessageBubble.tsx
import { FC, Fragment, ReactNode, useEffect, useState } from 'react';

/**
 * Show a message as plain text. The only markup understood is <strong>…</strong> (used in the
 * translation files for bold words); anything else is shown as text, never as HTML (audit L1).
 */
export function renderSimpleText(text: string): ReactNode {
    const parts = text.split(/(<strong>[\s\S]*?<\/strong>)/g);
    return parts.map((part, i) => {
        const m = part.match(/^<strong>([\s\S]*?)<\/strong>$/);
        return m ? <strong key={i}>{m[1]}</strong> : <Fragment key={i}>{part}</Fragment>;
    });
}

interface MessageBubbleProps {
    text?: string;
    isOutgoing?: boolean;
    timestamp?: string;
    children?: ReactNode;
    fullWidth?: boolean; // New prop for conditional full width
    centered?: boolean;  // Forms and screens: full width on phones, centred with a readable max width on wide screens
    className?: string;
}

const MessageBubble: FC<MessageBubbleProps> = ({ text, isOutgoing = false, timestamp, children, fullWidth = false, centered = false, className = '' }) => {
    const [clientTimestamp, setClientTimestamp] = useState<string | null>(null);

    useEffect(() => {
        // Set the timestamp on the client side to avoid SSR mismatch
        setClientTimestamp(timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, [timestamp]);

    return (
        <div className={`flex ${centered ? 'justify-center' : isOutgoing ? 'justify-end' : 'justify-start'} mb-2 ${fullWidth || centered ? 'w-full' : 'w-auto'} ${className}`}>
            <div className={`${centered ? 'w-full max-w-2xl' : fullWidth ? 'w-full' : 'max-w-sm md:max-w-md lg:max-w-lg'} p-3 rounded-2xl ${isOutgoing ? 'bg-[#DCF8C6]' : 'bg-white'} shadow-md`}>
                <div className="text-gray-700 font-normal text-base md:text-lg leading-relaxed">
                    {children ? (
                        children
                    ) : (
                        <span>{renderSimpleText(text || '')}</span>
                    )}
                </div>
                {clientTimestamp && (
                    <span className="text-xs text-gray-400 -mt-1 block text-right"> {/* Reduced margin and size */}
                        {clientTimestamp}
                    </span>
                )}
            </div>
        </div>
    );
};

export default MessageBubble;
