import axios from 'axios';

import { API_URL } from './apiConfig';


export interface ImageGenerationRequest {
    prompt: string;
    style?: string;
    width?: number;
    height?: number;
}

export interface ImageGenerationResponse {
    image_url: string;
}

export const imageService = {
    generateImage: async (request: ImageGenerationRequest): Promise<ImageGenerationResponse> => {
        try {
            const response = await axios.post(`${API_URL}/image-generation/generate-image`, request);
            return response.data;
        } catch (error) {
            console.error("Image generation error:", error);
            throw error;
        }
    }
};
