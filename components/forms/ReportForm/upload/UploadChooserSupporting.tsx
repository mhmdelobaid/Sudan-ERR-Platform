import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { UploadedList } from "./UploadedList";
import { FileWithProgress } from "./UploadInterfaces";
import performUpload from './performUpload';
import { v4 as uuidv4 } from 'uuid';
import { postImageRecordToDb } from './postImageRecordToDb';
import Icon from '../../../ui/Icon';
import CameraButton from '../../../ui/CameraButton';

const TILE = 'flex-1 min-w-[9rem] flex items-center justify-center gap-2 p-4 border rounded-md bg-white hover:bg-gray-50 text-gray-800';

export enum reportUploadType {
  RECEIPT,
  SUPPORTING,
}

export interface UploadChooserProps {
  id: string;
  uploadType: reportUploadType;
  projectId: string;
  reportId: string;
  expenseIndex?: number;
  onChange?: (fileWithProgress: FileWithProgress) => void;
}

export const UploadChooserSupporting: React.FC<UploadChooserProps> = ({
  id,
  projectId,
  reportId,
  expenseIndex,
  onChange,
}: UploadChooserProps) => {

  const [filesWithProgress, setFilesWithProgress] = useState<FileWithProgress[]>([]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;

    const newFiles = Array.from(e.target.files).map((file) => ({
      id: uuidv4(),
      file,
      uploaded: false,
      progress: 0,
    }));

    setFilesWithProgress((prev) => [...prev, ...newFiles]);

    for (const fileWithProgress of newFiles) {
      try {
        // Extract actual project ID if it's a path
        const actualProjectId = projectId.includes('/') 
          ? projectId.split('/')[1] // Get the UUID after 'projects/'
          : projectId;

        await performUpload(fileWithProgress.file, actualProjectId, {
          onProgress: (progress) => {
            setFilesWithProgress((prev) =>
              prev.map((f) =>
                f.id === fileWithProgress.id ? { ...f, progress } : f
              )
            );
          },
          onSuccess: async (url) => {
            console.log('Upload successful for expense index:', expenseIndex);
            console.log('Got URL:', url);
            
            setFilesWithProgress((prev) =>
              prev.map((f) =>
                f.id === fileWithProgress.id ? { ...f, uploaded: true } : f
              )
            );

            if (onChange) {
              onChange({
                id: fileWithProgress.id,
                file: fileWithProgress.file,
                uploaded: true,
                progress: 100,
                uploadedUrl: url
              });
            }
          },
          onError: (error) => {
            console.error('Upload failed:', error);
            setFilesWithProgress((prev) =>
              prev.map((f) =>
                f.id === fileWithProgress.id ? { ...f, error } : f
              )
            );
          },
        });
      } catch (error) {
        console.error("Upload failed:", error);
      }
    }
  };

  const getPath = (file: File, projectId: string, reportId: string) => `projects/${projectId}/reports/${reportId}/${file.name}`;

  const removeFile = (index: number) => {
    setFilesWithProgress((prevFiles) => prevFiles.filter((_, i) => i !== index));
  };


  return (
    <div className="max-w-lg mx-auto">
      <div className="flex flex-col gap-4">
        <UploadBox
          uploadType={reportUploadType.SUPPORTING}
          onFileChange={handleFileChange}
          uploadId={id}
        />
        <UploadedList files={filesWithProgress} removeFile={removeFile} />
      </div>
    </div>
  );
};

interface UploadBoxProps {
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadType: reportUploadType;
  uploadId: string;
}

const UploadBox: React.FC<UploadBoxProps> = ({ onFileChange, uploadType, uploadId }) => {
  const { t } = useTranslation("fillForm");
  const inputId = `file-upload-${uploadId}`;

  return (
    <div className="border-dashed border-2 border-gray-300 p-4 rounded-md flex flex-wrap gap-2">
      <CameraButton onChange={onFileChange} className={TILE} iconSize={22} />
      <input
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf"
        id={inputId}
        className="hidden"
        onChange={onFileChange}
      />
      <label
        htmlFor={inputId}
        className={`${TILE} cursor-pointer`}
      >
        <Icon name="upload" size={22} />
        {uploadType === reportUploadType.RECEIPT ? (
          <span>{t("chooseReceiptFiles")}</span>
        ) : (
          <span>{t("chooseFiles")}</span>
        )}
      </label>
    </div>
  );
};

