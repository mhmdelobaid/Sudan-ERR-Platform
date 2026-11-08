import { secureUpload, SecureUploadError } from "./secureUpload";

/**
 * Upload report files through the secure flow (quarantine -> check -> clean copy).
 * `url` in each result is the clean file's storage path, which is what reports store.
 */

export enum ImageCategory {
  FORM_CUSTOM,
  FORM_FILLED,
  FORM_SCANNED,
  REPORT_EXPENSES_FORM,
  REPORT_EXPENSES_RECEIPT,
  REPORT_EXPENSES_SUPPORTING_IMAGE
}

export interface UploadResult {
  filename?: string;
  success: boolean;
  errorMessage?: string;   // an uploads:errors.<code> code when the upload was refused
  url?: string;
}

export const uploadImages = async (
    files: File[],
    projectId: string,
    reportType: 'financial' | 'program'
): Promise<UploadResult[]> => {
    const results: UploadResult[] = [];
    for (const file of files) {
        try {
            const clean = await secureUpload(file, { projectId, kind: reportType === 'program' ? 'f5' : 'f4' });
            results.push({ filename: clean.name, success: true, url: clean.path });
        } catch (error: any) {
            results.push({
                filename: file?.name,
                success: false,
                errorMessage: error instanceof SecureUploadError ? error.code : 'server_error',
            });
        }
    }
    return results;
};
