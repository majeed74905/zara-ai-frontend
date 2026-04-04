import { GoogleGenAI } from "@google/genai";
const apiKey = "YOUR_GEMINI_API_KEY_HERE";

async function listModels() {
    try {
        const ai = new GoogleGenAI({
            apiKey: apiKey,
            apiVersion: 'v1beta'
        });
        const response = await ai.models.list();
        console.log("Keys:", Object.keys(response));
        // @ts-ignore
        if (response.models) console.log("Models length:", response.models.length);
    } catch (e: any) {
        console.error("Error:", e.message);
    }
}

listModels();
