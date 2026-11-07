import { newSupabase } from "./newSupabaseClient";

interface PathOptions {
    errName: string;
    projectName: string;
    fileName: string;
    reportType: 'financial' | 'program';
    reportId?: string;
}

/**
 * Sanitizes a name for use in a file path by:
 * - Converting to lowercase
 * - Replacing spaces with hyphens
 * - Removing special characters
 * - Limiting length
 */
function sanitizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50);
}

/**
 * A file name storage accepts: Latin letters, digits and hyphens, with its extension kept
 * (an Arabic name, or one with spaces, would otherwise be refused).
 */
function safeFileName(name: string): string {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
    const base = sanitizeName(dot > 0 ? name.slice(0, dot) : name) || 'file';
    return ext ? `${base}.${ext}` : base;
}

/**
 * Gets the current month folder name in YYYY-MM format
 */
function getCurrentMonthFolder(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Constructs the upload path following the new convention:
 * images/projects/{err_name}/{project_name}/{report_type}/{YYYY-MM}/{filename}
 */
export async function constructUploadPath({
    errName,
    projectName,
    fileName,
    reportType,
    reportId
}: PathOptions): Promise<string> {
    // An Arabic room or project name has no Latin letters left after sanitizing: never leave an empty folder
    const sanitizedErrName = sanitizeName(errName) || 'room';
    const sanitizedProjectName = sanitizeName(projectName) || 'project';
    const monthFolder = getCurrentMonthFolder();
    const timestamp = Date.now();
    const finalFileName = `${timestamp}-${safeFileName(fileName)}`;

    const basePath = `projects/${sanitizedErrName}/${sanitizedProjectName}/${reportType}/${monthFolder}`;
    return reportId ? `${basePath}/${reportId}/${finalFileName}` : `${basePath}/${finalFileName}`;
}

/**
 * Helper function to get ERR name from the users table
 */
export async function getErrName(): Promise<string> {
    try {
        const { data: { session } } = await newSupabase.auth.getSession();
        if (!session) {
            throw new Error('No active session');
        }

        const { data: userData, error: userError } = await newSupabase
            .from('users')
            .select('err_id')
            .eq('id', session.user.id)
            .single();

        if (userError || !userData) {
            throw new Error('Failed to get ERR ID');
        }

        const { data: errData, error: errError } = await newSupabase
            .from('emergency_rooms')
            .select('name')
            .eq('id', userData.err_id)
            .single();

        if (errError || !errData) {
            throw new Error('Failed to get ERR name');
        }

        return sanitizeName(errData.name) || String(userData.err_id);
    } catch (error) {
        console.error('Error getting ERR name:', error);
        throw error;
    }
}

/**
 * Helper function to get project name from the projects table
 */
export async function getProjectName(projectId: string): Promise<string> {
    try {
        const { data: project, error } = await newSupabase
            .from('err_projects')
            .select('project_objectives')
            .eq('id', projectId)
            .single();

        if (error || !project) {
            throw new Error('Failed to get project name');
        }

        return sanitizeName(project.project_objectives || '') || projectId;
    } catch (error) {
        console.error('Error getting project name:', error);
        throw error;
    }
} 