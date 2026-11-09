import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileWithProgress } from './UploadInterfaces';
import CameraButton from '../../../ui/CameraButton';
import Icon from '../../../ui/Icon';

interface UploadChooserSupportingProps {
    onFilesSelected: (files: FileWithProgress[]) => void;
    disabled?: boolean;
}

const UploadChooserSupporting: React.FC<UploadChooserSupportingProps> = React.memo(({ 
    onFilesSelected, 
    disabled 
}) => {
    const { t } = useTranslation('program-report');
    const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = event.target.files;
        if (!fileList) return;

        const files: FileWithProgress[] = Array.from(fileList).map(file => ({
            file,
            progress: 0
        }));

        onFilesSelected(files);
        
        // Reset the input value so the same file can be selected again if needed
        event.target.value = '';
    }, [onFilesSelected]);

    return (
        <div className="mb-4 space-y-2">
            <div className="flex flex-wrap gap-2">
                <CameraButton
                    onChange={handleFileChange}
                    disabled={disabled}
                    iconSize={18}
                    className="inline-flex items-center gap-1.5 py-2 px-4 rounded-xl text-sm font-semibold border border-brand-orange/60 text-brand-orange"
                />
                {/* A labelled button instead of the browser's own file box (it shows English text on phones) */}
                <label className={`inline-flex items-center gap-1.5 py-2 px-4 rounded-xl text-sm font-semibold border border-white/20 text-[#e8eef8] cursor-pointer ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Icon name="upload" size={18} />
                    {t('chooseFiles')}
                    <input
                        type="file"
                        onChange={handleFileChange}
                        disabled={disabled}
                        multiple
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="sr-only"
                    />
                </label>
            </div>
            <p className="text-xs text-[#8a97ab] m-0">{t('fileTypesHint')}</p>
        </div>
    );
});

UploadChooserSupporting.displayName = 'UploadChooserSupporting';

export default UploadChooserSupporting; 