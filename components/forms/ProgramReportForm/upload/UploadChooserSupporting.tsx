import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileWithProgress } from './UploadInterfaces';
import CameraButton from '../../../ui/CameraButton';
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
            <CameraButton
                onChange={handleFileChange}
                disabled={disabled}
                iconSize={18}
                className="inline-flex items-center gap-1.5 py-2 px-4 rounded-full text-sm font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100"
            />
            <input
                type="file"
                onChange={handleFileChange}
                disabled={disabled}
                multiple
                accept={ACCEPT_FILES}
                className="block w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100"
            />
            <p className="text-xs text-gray-500">{t('uploads:allowed')}</p>
            {refused.map((note, i) => (
                <p key={i} className="text-xs text-red-600">{note}</p>
            ))}
        </div>
    );
});

UploadChooserSupporting.displayName = 'UploadChooserSupporting';

export default UploadChooserSupporting; 