import { GoogleGenAI } from "@google/genai";
const apiKey = "YOUR_GEMINI_API_KEY_HERE";

async function listModels() {
    try {
        const ai = new GoogleGenAI({ apiKey: apiKey }); // Default (beta)
        console.log("Listing models (default)...");
        // @ts-ignore
        const response = await ai.models.list();
        // @ts-ignore
        console.log(JSON.stringify(response));
    } catch (e: any) {
        console.error("Error:", e.message);
    }
}

listModels();
