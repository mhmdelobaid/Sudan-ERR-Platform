// components/ui/CameraButton.tsx
// "Take a photo": opens the phone's back camera straight away, and the photo comes back to the same
// handler as a chosen file. Shown on phones and tablets only: browsers on computers can't open the
// camera from an upload button (they would just show the file picker again).
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';

/** True on phones and tablets (a touch screen is the main pointer). False while the page first renders. */
export function useCanTakePhoto(): boolean {
    const [ok, setOk] = useState(false);
    useEffect(() => {
        try { setOk(window.matchMedia('(pointer: coarse)').matches); } catch { setOk(false); }
    }, []);
    return ok;
}

interface Props {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    className?: string;
    disabled?: boolean;
    /** Defaults to "Take a photo". */
    label?: string;
    iconSize?: number;
}

const DEFAULT_CLASS = 'bg-primaryGreen text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-all inline-flex items-center justify-center gap-1.5';

const CameraButton: React.FC<Props> = ({ onChange, className = DEFAULT_CLASS, disabled, label, iconSize = 20 }) => {
    const { t } = useTranslation('fillForm');
    const canTakePhoto = useCanTakePhoto();
    if (!canTakePhoto) return null;
    return (
        <label className={`${className} ${disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
            <Icon name="photo_camera" size={iconSize} />
            {label || t('takePhoto')}
            <input type="file" accept="image/*" capture="environment" className="hidden" disabled={disabled} onChange={onChange} />
        </label>
    );
};

export default CameraButton;
