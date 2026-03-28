import { API_URL } from './apiConfig';

export const aiService = {
    async chat(message: string, token: string) {
        const response = await fetch(`${API_URL}/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ message }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'AI Chat failed');
        }
        return response.json();
    }
};
