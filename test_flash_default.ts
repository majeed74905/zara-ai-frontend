import { GoogleGenAI } from "@google/genai";
const apiKey = "YOUR_GEMINI_API_KEY_HERE";

async function test() {
    try {
        const ai = new GoogleGenAI({
            apiKey: apiKey
            // default version
        });
        console.log("Testing gemini-1.5-flash on default version...");
        const result = await ai.models.generateContent({
            model: 'models/gemini-1.5-flash',
            contents: [{ role: 'user', parts: [{ text: 'Hi' }] }]
        });
        console.log("Success:", result.text);
    } catch (e: any) {
        console.error("Error:", e.message);
    }
}

test();
