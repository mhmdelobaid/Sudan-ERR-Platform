// F5 supporting files: sent through the secure flow (quarantine -> check -> clean copy).
// file_url is the clean file's storage path; the database only accepts paths of checked files.
import { secureUpload } from '../../../../services/secureUpload';
import { FileWithProgress, FileUploadResponse } from './UploadInterfaces';

export default async function uploadFile(
    file: FileWithProgress,
    projectId: string,
    report_id: string,
    onProgress: (progress: number) => void
): Promise<FileUploadResponse> {
    const clean = await secureUpload(file.file, { projectId, kind: 'f5', onProgress });
    return {
        id: clean.id,
        file_name: clean.name,
        file_url: clean.path,
        file_type: clean.mime,
        file_size: clean.size
    };
}
