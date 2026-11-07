import { newSupabase } from "../../../../services/newSupabaseClient"
import * as tus from "tus-js-client";
import { constructUploadPath, getErrName, getProjectName } from "../../../../services/uploadPaths";

// Uploads go to the app's own database (the launch database), never to a fixed project: this used to name
// another Supabase project ("khavbdocjufkyhwpiniw"), so receipts left the launch database or failed.
const supabaseUrl = process.env.NEXT_PUBLIC_NEW_SUPABASE_URL;
const bucketName = "images"
const key = process.env.NEXT_PUBLIC_NEW_SUPABASE_ANON_KEY;

interface UploadCallbacks {
    onProgress: any,
    onSuccess: any,
    onError: any
}

export default async function uploadFile(file: File, projectId: string, { onProgress, onSuccess, onError }: UploadCallbacks ) {
    try {
        // Get ERR name and project name
        const errName = await getErrName();
        const projectName = await getProjectName(projectId);

        // Construct the new path
        const path = await constructUploadPath({
            errName,
            projectName,
            fileName: file.name,
            reportType: 'financial'
        });

        // Uploaded as the signed-in person, so the storage access rules apply to them
        const { data: { session } } = await newSupabase.auth.getSession();

        return new Promise((resolve, reject) => {
            var upload = new tus.Upload(file, {
                endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
                retryDelays: [0, 3000, 5000, 10000, 20000],
                headers: {
                    authorization: `Bearer ${session?.access_token || key}`,
                    apikey: key || '',
                    'x-upsert': 'false', // every name is new (it starts with the time), so nothing is overwritten
                },
                uploadDataDuringCreation: true,
                removeFingerprintOnSuccess: true,
                metadata: {
                    bucketName: bucketName,
                    objectName: path,
                    contentType: file.type,
                    cacheControl: '3600'
                },
                chunkSize: 6 * 1024 * 1024,
                onError: function (error) {
                    console.log('Failed because: ' + error)
                    reject(error)
                },
                onProgress: function (bytesUploaded, bytesTotal) {
                    var percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2)
                    if (onProgress) onProgress(percentage)
                },
                onSuccess: async function () {
                    // Get the public URL after successful upload
                    const { data: { publicUrl } } = newSupabase.storage
                        .from('images')
                        .getPublicUrl(path);
                    
                    console.log("Upload completed, URL:", publicUrl)
                    if (onSuccess) onSuccess(publicUrl)
                    resolve(publicUrl)
                },
            })

            return upload.findPreviousUploads().then(function (previousUploads) {
                if (previousUploads.length) {
                    upload.resumeFromPreviousUpload(previousUploads[0])
                }
                upload.start()
            })
        });
    } catch (error) {
        onError(error);
        throw error;
    }
}