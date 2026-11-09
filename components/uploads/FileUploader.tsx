// Components/FileUploader.tsx
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadImages } from "../../services/uploadImages";
import { ACCEPT_FILES } from "../../services/secureUpload";
import Icon from "../ui/Icon";
import CameraButton from "../ui/CameraButton";

interface FileUploaderProps {
  projectId: string;
  onUploadComplete: (urls: string[]) => void;
}

/**
  * UI for choosing files to upload for expense reports (TODO: For Scan Form only, right?)
  * 
  * TODO: Move non-UI controller stuff into api or elsewhere
  * TODO: See if we need the URL anywhere else besides what we are doing here.
  * TODO: Figure out what we are doing with upload results viz. array vs. singular
  * 
  * @param param0 
  * @returns 
*/

const FileUploader: React.FC<FileUploaderProps> = ({ projectId, onUploadComplete }) => {
  const { t, i18n } = useTranslation("scanForm"); // Use scanForm namespace for translations
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!projectId) {
      console.error('Project ID is required for uploading files');
      alert(t("errors.missing_project_id"));
      return;
    }

    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      setFiles(selectedFiles);
      setUploading(true);

      try {
        // Upload what was just chosen (the files state isn't updated yet at this point).
        const results = await uploadImages(
          selectedFiles,
          projectId,
          'financial'  // Since this is used for expense reports
        );
        const failed = results.find(r => !r.success);
        if (failed) {
          throw new Error(failed.errorMessage);
        }
        const urls = results.map(r => r.url).filter((u): u is string => !!u);

        onUploadComplete(urls);
        setFiles([]);
      } catch (error) {
        console.error('Failed to upload files.', error);
        const code = error instanceof Error ? error.message : '';
        alert(i18n.exists(`uploads:errors.${code}`) ? t(`uploads:errors.${code}`) : t("errors.upload_failed"));
      } finally {
        setUploading(false);
      }
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <CameraButton onChange={handleFileChange} disabled={uploading}
          className="bg-primaryGreen text-white py-2 px-4 rounded-lg shadow-md hover:bg-green-700 transition-all inline-flex items-center justify-center gap-1.5" />
        {/* "Choose Files" button styled as a label */}
        <label className="bg-primaryGreen text-white py-2 px-4 rounded-lg shadow-md hover:bg-green-700 transition-all cursor-pointer inline-flex items-center justify-center gap-1.5">
          <Icon name="photo_library" size={20} />
          {uploading ? t("uploading") : t("choose_files")}
          <input
            type="file"
            accept={ACCEPT_FILES}
            multiple
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />
        </label>
      </div>
      {/* Display selected file names */}
      {files.length > 0 && !uploading && (
        <span className="text-gray-600 ml-2">
          {files.map((file) => file.name).join(", ")}
        </span>
      )}
    </div>
  );
};

export default FileUploader;


