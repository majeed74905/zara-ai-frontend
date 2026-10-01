/**
 * Centralized API configuration to handle environment-specific base URLs.
 * This ensures that the backend URL is correctly formatted with the necessary API versioning.
 */

const PRODUCTION_API_URL = 'https://my-project-5u48.onrender.com/api/v1';

const isLocalHost = (host: string) =>
    host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.local');

const getBaseUrl = () => {
    let url = import.meta.env.VITE_API_URL || PRODUCTION_API_URL;

    // Safety net: a build made with a local .env bakes http://localhost:8000 into the bundle.
    // On a deployed site that address is the visitor's own machine, so every request fails.
    // Whenever the page itself isn't served from localhost, use the production backend.
    try {
        if (typeof window !== 'undefined' && /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(url)
            && !isLocalHost(window.location.hostname)) {
            console.warn('[Zara] VITE_API_URL points at localhost but the site is deployed — using the production API instead.');
            url = PRODUCTION_API_URL;
        }
    } catch { /* non-browser build context */ }

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
