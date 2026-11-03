
import React, { useState } from "react";
import { useTranslation } from 'react-i18next';
import { FileWithProgress } from "./UploadInterfaces";
import Icon from '../../../ui/Icon';


interface UploadedListProps {
    files: FileWithProgress[];
    removeFile: (index: number) => void;
}

export const UploadedList: React.FC<UploadedListProps> = ({ files, removeFile }) => {
  const { t } = useTranslation('fillForm');

  return (
    <div>
      {files.length > 0 && (
        <div className="mt-4">
          <ul className="space-y-2">
            {files.map((fileWithProgress, index) => (
            <li key={`${index}`} className="flex items-center justify-between gap-4 p-2 border rounded-md">
                <span className="truncate">{fileWithProgress.file.name}</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-2 bg-gray-200 rounded">
                    <div className="h-2 bg-blue-500 rounded transition transition-width ease-in-out" style={{ width: `${fileWithProgress.progress}%` }}></div>
                  </div>
                  {fileWithProgress.uploaded &&
                     <Icon name="check_circle" size={16} className="text-green-500" /> 
                  }

                  )
                  {/* <button onClick={() => removeFile(index)} className="text-red-500 hover:text-red-700 text-xs inline-flex items-center justify-center gap-1.5"><Icon name="delete" size={16} />
                    {t('Remove').toLowerCase()}
                  </button> */}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}