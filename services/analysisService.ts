import { API_URL } from './apiConfig';


export const analysisService = {
    async analyzeFiles(files: File[]): Promise<{ context_text: string; results: any[] }> {
        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', file);
        });

        const response = await fetch(`${API_URL}/analysis/analyze_files`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`File analysis failed: ${response.statusText}`);
        }

        return response.json();
    }
};
