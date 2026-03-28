/**
 * Centralized API configuration to handle environment-specific base URLs.
 * This ensures that the backend URL is correctly formatted with the necessary API versioning.
 */

const getBaseUrl = () => {
    let url = import.meta.env.VITE_API_URL || 'https://my-project-5u48.onrender.com/api/v1';
    
    // Remove trailing slash if it exists to prevent double slashes in paths
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    // Heuristic: If it's a production URL (e.g. onrender.com) and doesn't contain /api/v1,
    // append it automatically as the backend expects it.
    if (url && !url.includes('/api/v1')) {
        url += '/api/v1';
    }

    return url;
};

export const API_URL = getBaseUrl();
