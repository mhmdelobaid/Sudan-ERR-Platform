import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileWithProgress } from './UploadInterfaces';
import CameraButton from '../../../ui/CameraButton';
import Icon from '../../../ui/Icon';
import { ACCEPT_FILES, precheckFile } from '../../../../services/secureUpload';

interface UploadChooserSupportingProps {
    onFilesSelected: (files: FileWithProgress[]) => void;
    disabled?: boolean;
}

const UploadChooserSupporting: React.FC<UploadChooserSupportingProps> = React.memo(({ 
    onFilesSelected, 
    disabled 
}) => {
    const { t } = useTranslation('program-report');
    const [refused, setRefused] = useState<string[]>([]);
    const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = event.target.files;
        if (!fileList) return;

        const chosen = Array.from(fileList);
        const notes: string[] = [];
        const files: FileWithProgress[] = chosen
            .filter(file => {
                const problem = precheckFile(file);
                if (problem) notes.push(t('uploads:rejected', { name: file.name, reason: t(`uploads:errors.${problem}`) }));
                return !problem;
            })
            .map(file => ({ file, progress: 0 }));
        setRefused(notes);

        if (files.length) onFilesSelected(files);
        
        // Reset the input value so the same file can be selected again if needed
        event.target.value = '';
    }, [onFilesSelected, t]);

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
                        accept={ACCEPT_FILES}
                        className="sr-only"
                    />
                </label>
            </div>
            <p className="text-xs text-[#8a97ab] m-0">{t('fileTypesHint')}</p>
            {refused.map((note, i) => (
                <p key={i} className="text-xs text-red-400 m-0">{note}</p>
            ))}
        </div>
    );
});

UploadChooserSupporting.displayName = 'UploadChooserSupporting';

export default UploadChooserSupporting; 