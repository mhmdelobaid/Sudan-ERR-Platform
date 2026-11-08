// F4 receipts and supporting files: sent through the secure flow (quarantine -> check -> clean copy).
// onSuccess receives the clean file's storage path, which is what the report stores.
import { secureUpload, SecureUploadError } from "../../../../services/secureUpload";

interface UploadCallbacks {
    onProgress: (percentage: number) => void,
    onSuccess: (path: string) => void,
    onError: (code: string) => void
}

export default async function uploadFile(file: File, projectId: string, { onProgress, onSuccess, onError }: UploadCallbacks) {
    try {
        const clean = await secureUpload(file, { projectId, kind: 'f4', onProgress });
        if (onSuccess) onSuccess(clean.path);
        return clean.path;
    } catch (error: any) {
        const code = error instanceof SecureUploadError ? error.code : 'server_error';
        if (onError) onError(code);
        throw error;
    }
}
