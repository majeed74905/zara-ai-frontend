import axios from 'axios';

import { API_URL } from './apiConfig';

export interface ChatHistoryTurn {
    role: 'user' | 'assistant';
    content: string;
}

export interface BackendChatOptions {
    /** Recent turns of THIS conversation, oldest first. */
    history?: ChatHistoryTurn[];
    /** Stable id of the conversation (anonymous server memory fallback). */
    sessionId?: string;
    /** The user's own words when `message` also carries extra context (files, repo manifest). */
    userText?: string;
    /** Ask Zara to reason more deeply (same personality, more thinking). */
    deepThinking?: boolean;
}

export interface BackendChatResult {
    response: string;
    model_used: string;
    detected_language?: string;
}

const REQUEST_TIMEOUT_MS = 120_000;

const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
};

export const sendMessageToBackend = async (
    message: string,
    model: string,
    interactionMode: string = 'chat',
    module: string = 'chat',
    task: string = 'chat',
    options: BackendChatOptions = {}
): Promise<BackendChatResult> => {
    try {
        const res = await axios.post(
            `${API_URL}/ai/chat`,
            {
                message,
                model,
                interaction_mode: interactionMode,
                module,
                task,
                session_id: options.sessionId,
                history: options.history,
                user_text: options.userText,
                deep_thinking: options.deepThinking,
                // User's local hour, so greetings can be time-aware ("good evening")
                client_hour: new Date().getHours(),
            },
            { headers: authHeaders(), timeout: REQUEST_TIMEOUT_MS }
        );
        return res.data;
    } catch (error) {
        console.error("Backend Chat Error:", error);
        throw error;
    }
};

/**
 * Turn any chat failure into a short, human message for the UI.
 * Technical details stay in the console for developers.
 */
export const getFriendlyChatError = (error: any): string => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return "You're offline. Check your internet connection and try again.";
    }
    const status: number | undefined = error?.response?.status;
    const detail: string | undefined = error?.response?.data?.detail;

    if (error?.code === 'ECONNABORTED') {
        return "Zara took too long to respond. The server may be waking up — please try again.";
    }
    if (!error?.response) {
        return "Couldn't reach Zara's server. It may be starting up — please try again in a few seconds.";
    }
    if (status === 429) {
        return typeof detail === 'string' ? detail : "You're sending messages a bit fast. Give it a few seconds and try again.";
    }
    if (status === 413) {
        return "That message is too long. Try shortening it or splitting it into parts.";
    }
    if (status === 400 && typeof detail === 'string') {
        return detail;
    }
    if (status && status >= 500) {
        return typeof detail === 'string' && detail.length < 200
            ? detail
            : "Zara's AI service is having trouble right now. Please try again in a moment.";
    }
    return "Something went wrong. Please try again.";
};
