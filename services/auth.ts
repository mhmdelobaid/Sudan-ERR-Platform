// Server-side session helpers. (The old home-made JWT helpers and JWT_SECRET_KEY were removed 26 Oct 2026, audit M7: nothing used them.)
import { newSupabase } from './newSupabaseClient';
import { createAuthenticatedClient } from './createAuthenticatedClient';
import { appAccess } from './appAccess';

/**
 * Validate a Supabase session token
 * @param token - Supabase session token to validate
 * @returns User data if valid, null otherwise
 */
export const validateSession = async (token: string) => {
    try {
        const { data: { user }, error } = await newSupabase.auth.getUser(token);
        
        if (error || !user) {
            return null;
        }

        // Create an authenticated client for database queries
        const authenticatedClient = createAuthenticatedClient(token);

        // Get additional user data from our users table
        const { data: userData, error: userError } = await authenticatedClient
            .from('users')
            .select('role, status, display_name, err_id')
            .eq('id', user.id)
            .single();

        if (userError || !userData) {
            return null;
        }

        // Only return data if user is active
        // Only active ERR, support and admin accounts (not partners)
        if (appAccess(userData) !== 'ok') {
            return null;
        }

        return {
            id: user.id,
            email: user.email,
            err_id: userData.err_id,
            role: userData.role,
            status: userData.status,
            display_name: userData.display_name
        };
    } catch (error) {
        console.error('Session validation error:', error);
        return null;
    }
};

/**
 * Get current session
 * @returns Current session if exists, null otherwise
 */
export const getCurrentSession = async () => {
    try {
        const { data: { session }, error } = await newSupabase.auth.getSession();
        if (error || !session) {
            return null;
        }
        return session;
    } catch (error) {
        console.error('Get session error:', error);
        return null;
    }
};

/**
 * Sign out current user
 */
export const signOut = async () => {
    try {
        const { error } = await newSupabase.auth.signOut();
        if (error) {
            console.error('Sign out error:', error);
        }
    } catch (error) {
        console.error('Sign out error:', error);
    }
};
