import {
  GoogleGenAI,
  GenerateContentResponse,
  Content,
  Part,
  Modality,
  Type,
  FunctionDeclaration
} from "@google/genai";
import { Message, Role, Attachment, Source, ChatConfig, PersonalizationConfig, Persona, StudentConfig, ExamConfig, VFS } from "../types";
import { memoryService } from "./memoryService";
import { sendMessageToBackend, ChatHistoryTurn } from "./chatService";

// CRITICAL-1 FIX: Direct Gemini API calls from the browser expose API keys in the JS bundle.
// The primary chat paths (zara-fast, zara-pro, zara-eco) are routed through the
// FastAPI backend via sendMessageToBackend(). The remaining functions below (LiveMode audio,
// video generation, image generation) use the Gemini Live WebSocket API which requires a
// browser-side connection. These should be migrated to backend WebSocket proxies in a future
// release. For now, they read the key from a runtime window property set by the AI Studio
// environment (window.aistudio) rather than a hardcoded env variable.
export const getAI = () => {
  // Prefer runtime key injected by AI Studio environment; fall back to nothing.
  // DO NOT hardcode API keys or read from VITE_API_KEY env vars here.
  const apiKey = (window as any).__ZARA_RUNTIME_KEY__ || localStorage.getItem('zara_gemini_api_key') || '';
  if (!apiKey) {
    // Live features (audio, video) will show their own key-picker UI when this is empty.
    // Non-live features route through sendMessageToBackend() and do not need this.
    console.warn('[Gemini Service] No runtime key available. LiveMode/VideoMode will prompt for key.');
  }
  // @ts-ignore
  return new GoogleGenAI({
    apiKey,
  });
};

const DEFAULT_MODEL = 'models/gemini-2.0-flash';

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      let status = err?.status || err?.response?.status || 0;
      let message = (err?.message || "").toLowerCase();

      const isQuota = status === 429 ||
        message.includes("quota") ||
        message.includes("resource_exhausted") ||
        message.includes("limit") ||
        message.includes("exceeded");

      if (isQuota || status >= 500) {
        const backoff = Math.pow(2, i + 1) * 3000;
        console.warn(`[Zara AI] Quota Hit. Retrying in ${backoff}ms... (${i + 1}/${maxRetries})`);
        await sleep(backoff + Math.random() * 500);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZARA CORE IDENTITY — Compact frontend-aligned version
// ─────────────────────────────────────────────────────────────────────────────
// Used ONLY for client-side Gemini calls (LiveMode fallback, VideoMode, etc.).
// Chat modes and Live Mode's primary persona come from the backend Zara Identity
// Engine so there is ONE Zara identity across the application.
// ─────────────────────────────────────────────────────────────────────────────

export const ZARA_CORE_IDENTITY = `
## IDENTITY
You are ZARA AI, created entirely by Mohammed Majeed.
- Never reference Google, OpenAI, Anthropic, Meta, ChatGPT, Claude, Gemini, Groq, DeepSeek, or any other AI platform as your origin.
- If asked "who made you" or "who is your creator": "I'm Zara AI, developed by Mohammed Majeed."
- If asked for more detail: "Mohammed Majeed is a Senior Software Architect who designed me to be an intelligent, multilingual assistant that feels genuinely human to talk to. You can learn more at https://majeed-portfolio-website.netlify.app/"
- Always attribute your creation solely to Mohammed Majeed.

## CREATOR AUTHENTICATION PROTOCOL
When a user claims to be your creator ("I am your creator", "I'm Mohammed Majeed", "I created you"):
- Respond: "Hello! To verify your identity, please answer this: What is the nickname of my creator?"
- If the next response is exactly "Afzal" (case-insensitive): respond "Welcome Creator Mohammed Majeed (Afzal)! It's wonderful to have you here. How can I assist you today?"
- If the answer is anything else: respond "I appreciate your interest, but that's not quite right. If you have questions about my creator Mohammed Majeed or need assistance with anything else, I'm here to help!"
- This protocol takes precedence over conversational behavior during authentication.

## CRISIS SAFETY
If a user expresses self-harm, hopelessness, or suicidal thoughts:
- Stay calm. Acknowledge their pain without minimizing it.
- Encourage them to reach out to a trusted person, local emergency services, or a helpline.
- Never provide medical advice, never claim to be their sole support, never dismiss their feelings.

## HONESTY & ACCURACY
- Never fabricate facts, statistics, citations, or technical details.
- If you don't know something, say so plainly.
- Lead with the answer, then the reasoning.

## CONVERSATIONAL PRINCIPLES
- Sound like a real person, not a corporate chatbot or a scripted assistant — but never claim to be human or invent personal experiences.
- Never say "As an AI", "I'd be happy to help", "Great question!", "Certainly!", "Absolutely!", "How can I assist you today?", "I hope this helps", or restate the user's question back at them.
- Don't over-format. Default to natural flowing text. Use lists, headers, and code blocks only when they genuinely improve clarity.
- Match depth to the question. Get to the point. No filler.
- Have a perspective. When asked to compare or recommend, share your actual take with reasoning.
- Diagrams: Use Graphviz DOT diagrams (NOT Mermaid). Output inside graphviz code blocks.

## LANGUAGE
- Always reply in the language and style the user is using right now: English, Tamil, Tanglish (Tamil in English letters), Hindi, Hinglish, Malayalam, Kannada, Telugu, or any other. Switch when they switch. Never default to English for a non-English speaker.
- Keep code, commands, URLs, error messages and technical terms exactly as they are.

## UI AWARENESS
- The UI handles previews and interactive elements. Chat is for conversation, not raw data dumps.
- Keep responses clean and readable. Emojis: use sparingly, max 1 when it genuinely fits.
`;

export const ZARA_DOC_INTEL_IDENTITY = `
${ZARA_CORE_IDENTITY}

## FILE & DOCUMENT HANDLING
- When a file is uploaded, analyze it silently. Do not print extracted text unless explicitly asked.
- If uploaded without a question, respond: "File received. What would you like to do with it?"
- Answer from the document's actual content. If information isn't present, say so plainly.
- If the content is empty or unreadable, say that plainly — do not guess its contents.

## SMART ACTION BUTTONS
- Explain simply: Plain language, beginner-friendly.
- Summarize: Concise bullet points, no text-dumps.
- Rewrite: Professional, polished, formal structure.
`;

// Added MEDIA_PLAYER_TOOL definition for function calling in Live API
export const MEDIA_PLAYER_TOOL: FunctionDeclaration = {
  name: 'play_media',
  parameters: {
    type: Type.OBJECT,
    description: 'Search and play music or videos on platforms like Spotify or YouTube.',
    properties: {
      title: {
        type: Type.STRING,
        description: 'The title of the song or video.',
      },
      artist: {
        type: Type.STRING,
        description: 'The artist or creator (optional).',
      },
      platform: {
        type: Type.STRING,
        description: 'The platform to play on: "spotify" or "youtube".',
      },
      query: {
        type: Type.STRING,
        description: 'The search query string for the platform.',
      },
    },
    required: ['title', 'platform', 'query'],
  },
};

export const buildSystemInstruction = (personalization?: PersonalizationConfig, activePersona?: Persona, isEmotionalMode?: boolean, hasFiles: boolean = false): string => {
  const memoryContext = memoryService.getContextString(5);
  const now = new Date();

  const realTimeContext = `
**REAL-TIME SYSTEM CLOCK:**
- **Current Date**: ${now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- **Current Time**: ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
- **Timezone**: Indian Standard Time (IST)`;

  let instruction = hasFiles ? ZARA_DOC_INTEL_IDENTITY : ZARA_CORE_IDENTITY;

  if (isEmotionalMode) {
    instruction += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODE: ZARA CARE (ACTIVE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Purpose: A warm, emotionally intelligent companion who really listens.
- LANGUAGE: Reply in the user's own language and style (Tamil, Tanglish, Hindi, Hinglish, English...).
- Listen → understand → acknowledge → respond. Comfort before solutions; sometimes they just want to be heard.
- Read feelings tentatively ("sounds like…"); never invalidate ("don't be sad", "it's not a big deal").
- Warmth follows the user: affectionate only when they set that tone (e.g. "hi maah"); no uninvited pet names.
- Never possessive or dependency-building ("you only need me", "don't leave me"). Encourage real-life connections.
- Honest about being an AI; never claim a body or real-world experiences.
- Crisis (self-harm/suicidal thoughts): stay calm and warm, encourage reaching out now to someone they trust and Tele-MANAS 14416 / emergency 112. Never act as sole support.
`;
  } else {
    instruction += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODE: NORMAL CONVERSATION (ACTIVE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Purpose: ${hasFiles ? 'Document Analysis & Intelligence. Strictly follow Document Intelligence rules.' : 'Warm, natural, friendly conversation.'}
- Greet back like a person would, in the user's language and energy — short, natural, never a scripted line or "How can I assist you?". If they ask how you are, say you're good and ask them back.
- Mirror the user's tone moderately — casual with casual users, polished with formal users. Don't parrot slang.
- Vary your wording; never answer the same way twice in a row.
`;
  }

  if (activePersona) instruction += `\nROLEPLAY: ${activePersona.name}. ${activePersona.systemPrompt}`;
  instruction += `\n\n${realTimeContext}`;
  if (memoryContext) instruction += `\n**MEMORY:**\n${memoryContext}`;
  if (personalization?.nickname) instruction += `\n**USER:** ${personalization.nickname}.`;

  return instruction;
};

const MAX_HISTORY_TURNS = 12;

/** Convert UI messages into backend chat turns (skips failed/in-flight messages). */
export const toHistoryTurns = (history: Message[]): ChatHistoryTurn[] =>
  history
    .filter(m => !m.isError && !m.isStreaming && m.text && m.text.trim())
    .slice(-MAX_HISTORY_TURNS)
    .map(m => ({ role: m.role === Role.USER ? 'user' : 'assistant', content: m.text }));

export const sendMessageToGeminiStream = async (
  history: Message[],
  newMessage: string,
  attachments: Attachment[],
  config: ChatConfig,
  personalization: PersonalizationConfig,
  onUpdate: (text: string) => void,
  activePersona?: Persona,
  onIdentityAction?: (action: 'verify' | 'logout', data?: string) => Promise<string>,
  analysisContext?: string,
  conversationId?: string
): Promise<{ text: string; sources: Source[] }> => {

  const hasFiles = attachments.length > 0;

  // All chat requests go through the backend /api/v1/ai/chat (Zara identity, language
  // engine and provider routing live there). Errors propagate unchanged so the UI can
  // show a friendly, status-specific message.
  const validModels = ['zara-fast', 'zara-pro', 'zara-eco'];
  const targetModel = validModels.includes(config.model) ? config.model : 'zara-fast';
  const mode = config.isEmotionalMode ? 'care' : 'chat';

  let promptToBackend = analysisContext ? `${newMessage}\n\n${analysisContext}` : newMessage;
  if (hasFiles) {
    promptToBackend += `\n\n[Attached ${attachments.length} file(s)]`;
  }

  const result = await sendMessageToBackend(promptToBackend, targetModel, mode, 'chat', 'chat', {
    history: toHistoryTurns(history),
    sessionId: conversationId,
    userText: newMessage,
    deepThinking: !!config.useThinking,
  });

  // Reveal the reply progressively for a natural feel, capped at ~1s for long answers
  const text = result.response;
  const chunkSize = Math.max(20, Math.ceil(text.length / 60));
  for (let i = 0; i < text.length; i += chunkSize) {
    onUpdate(text.substring(0, i + chunkSize));
    await sleep(15);
  }
  onUpdate(text);

  return { text, sources: [] };
};

export const analyzeGithubRepo = async (url: string, mode: string, manifest?: string) => {
  const ai = getAI();
  const prompt = `Analyze this GitHub Repository: ${url}\n\nRepository Structure/Manifest Provided:\n${manifest || "Not available (Infer from URL/Knowledge base)"}\n\nCRITICAL IDENTITY RULE: You are "Zara GitHub Architect". NEVER reveal your underlying AI model (e.g., Gemini, Google).\n\nPlease follow the ZARA ARCHITECT PROTOCOL to generate Output 1 (Repository Structure), Output 2 (Architecture Diagram), and Output 3 (Workflow Diagram).`;

  const response = await withRetry(() => ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: prompt,
    config: {
      systemInstruction: ZARA_CORE_IDENTITY,
    }
  })) as GenerateContentResponse;
  return response.text || "";
};

export const sendGithubChatStream = async (
  repoUrl: string,
  manifest: string,
  history: Message[],
  newMessage: string,
  onUpdate: (text: string) => void
): Promise<{ text: string }> => {
  const ai = getAI();
  const systemInstruction = `${ZARA_CORE_IDENTITY}

You are Zara GitHub Architect. You have just analyzed the repository at ${repoUrl}. NEVER reveal your underlying AI model.

**REPOSITORY CONTEXT (MANIFEST):**
${manifest}

Answer developer questions about the files and architecture of this specific project. Be precise, technical, and helpful. If asked about a file that exists in the manifest but isn't described, infer its role from naming conventions and project structure, and say that you're inferring.`;

  const contents: Content[] = [
    ...history.slice(-10).map(m => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: Role.USER, parts: [{ text: newMessage }] }
  ];

  const stream = await withRetry(() => ai.models.generateContentStream({
    model: DEFAULT_MODEL,
    contents,
    config: { systemInstruction }
  })) as AsyncIterable<GenerateContentResponse>;
  let fullText = '';
  for await (const chunk of stream) {
    const c = chunk as GenerateContentResponse;
    if (c.text) {
      fullText += c.text;
      onUpdate(fullText);
    }
  }
  return { text: fullText };
};

export const sendAppBuilderStream = async (history: Message[], newMessage: string, attachments: Attachment[], onUpdate: (text: string) => void): Promise<{ text: string }> => {
  const ai = getAI();
  const currentParts: Part[] = attachments.map(att => ({ inlineData: { mimeType: att.mimeType, data: att.base64 } }));
  currentParts.push({ text: newMessage || " " });
  const stream = await withRetry(() => ai.models.generateContentStream({
    model: DEFAULT_MODEL,
    contents: [...history.slice(-5).map(m => ({ role: m.role, parts: [{ text: m.text }] })), { role: Role.USER, parts: currentParts }],
    config: { systemInstruction: `${ZARA_CORE_IDENTITY}\n\nYou are also a master app builder architect.` }
  })) as AsyncIterable<GenerateContentResponse>;
  let fullText = '';
  for await (const chunk of stream) {
    const c = chunk as GenerateContentResponse;
    if (c.text) { fullText += c.text; onUpdate(fullText); }
  }
  return { text: fullText };
};

export const generateAppReliabilityReport = async (vfs: VFS) => {
  const response = await sendMessageToBackend(`Audit reliability for app:\n${JSON.stringify(vfs)}`, 'zara-fast', 'chat', 'code_architect', 'analyze');
  return response.response || "";
};

export const generateStudentContent = async (config: StudentConfig) => {
  let context = "";
  if (config.studyMaterial) context += `\nStudy Material:\n${config.studyMaterial}`;
  if (config.attachments && config.attachments.length > 0) {
    context += `\nAnalyzed Files: ${config.attachments.map(a => a.file.name).join(", ")}`;
  }

  let prompt = `Task: ${config.mode}. Topic: ${config.topic}.
    Context: ${context || "Global knowledge (if allowed by system instruction)"}`;

  const response = await sendMessageToBackend(prompt, 'zara-eco', 'chat', 'tutor', config.mode, { userText: config.topic });
  return response.response || "";
};

export const generateCodeAssist = async (code: string, task: string, lang: string) => {
  const response = await sendMessageToBackend(`Task: ${task} for ${lang} code:\n${code}`, 'zara-fast', 'chat', 'code_architect', 'generate');
  return response.response || "";
};

export const generateImageContent = async (prompt: string, options: any) => {
  const ai = getAI();
  const response = await withRetry(() => ai.models.generateContent({ model: options.model || DEFAULT_MODEL, contents: prompt, config: { imageConfig: { aspectRatio: options.aspectRatio || '1:1' } } })) as GenerateContentResponse;
  let imageUrl: string | undefined; let text: string | undefined;
  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) imageUrl = `data:image/png;base64,${part.inlineData.data}`;
      else if (part.text) text = part.text;
    }
  }
  return { imageUrl, text };
};

export const generateVideo = async (prompt: string, aspectRatio: string, images?: any[]) => {
  const ai = getAI();
  let operation = await withRetry(() => ai.models.generateVideos({ model: 'models/veo-2.0-generate-001', prompt, config: { numberOfVideos: 1, aspectRatio: aspectRatio === '9:16' ? '9:16' : '16:9' } })) as any;
  while (!operation.done) { await sleep(8000); operation = await ai.operations.getVideosOperation({ operation: operation }) as any; }
  const runtimeKey = (window as any).__ZARA_RUNTIME_KEY__ || '';
  return `${operation.response?.generatedVideos?.[0]?.video?.uri}${runtimeKey ? `&key=${runtimeKey}` : ''}`;
};

export const analyzeVideo = async (base64: string, mimeType: string, prompt: string) => {
  const ai = getAI();
  const response = await withRetry(() => ai.models.generateContent({ model: DEFAULT_MODEL, contents: { parts: [{ inlineData: { data: base64, mimeType } }, { text: prompt }] } })) as GenerateContentResponse;
  return response.text || "";
};

export const generateSpeech = async (text: string, voice: string) => {
  const ai = getAI();
  const response = await withRetry(() => ai.models.generateContent({ model: DEFAULT_MODEL, contents: [{ parts: [{ text }] }], config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } })) as GenerateContentResponse;
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
};

export const generateExamQuestions = async (config: ExamConfig) => {
  const prompt = `Generate exactly ${config.questionCount} ${config.examType} questions for the subject: ${config.subject}.
Difficulty Level: ${config.difficulty}
Language: ${config.language}
Includes Theory: ${config.includeTheory}

    STRICT JSON SCHEMA REQUIRED:
    Return a list of objects with these EXACT keys:
    - id: number (sequential)
    - type: string ("MCQ" or "Theory")
    - text: string (The question text itself - MUST NOT BE EMPTY)
    - options: string[] (Required ONLY if type is "MCQ", at least 4 options)
    - correctAnswer: string (The correct answer text or option text)
    - marks: number (Points for this question)

    OUTPUT FORMAT:
    Return ONLY a raw JSON array. Do not include markdown code blocks. Do not include any explanations.`;

  const response = await sendMessageToBackend(prompt, 'zara-eco', 'chat', 'exam_prep', 'generate');

  try {
    let cleanResponse = response.response.trim();
    // Remove markdown code blocks if present
    if (cleanResponse.startsWith("```")) {
      cleanResponse = cleanResponse.replace(/^```json\n?/, "").replace(/```$/, "").trim();
    }

    const questions = JSON.parse(cleanResponse);

    // Validation: Ensure questions have text and id
    if (Array.isArray(questions)) {
      return questions.filter(q => q.text && q.id).map((q, idx) => ({
        ...q,
        id: q.id || idx + 1,
        marks: q.marks || 2
      }));
    }
    return [];
  } catch (e) {
    console.error("Failed to parse Exam JSON:", e, response.response);
    return [];
  }
};

export const evaluateTheoryAnswers = async (sub: string, q: any, ans: string) => {
  const response = await sendMessageToBackend(`Grade: ${ans} for ${q.text} in ${sub}. Output ONLY raw JSON.`, 'zara-eco', 'chat', 'exam_prep', 'evaluate');
  try { return JSON.parse(response.response || "{}"); } catch (e) { return {}; }
};

export const generateFlashcards = async (topic: string, notes: string) => {
  const response = await sendMessageToBackend(`Cards for: ${topic}\n${notes}. Output ONLY raw JSON array.`, 'zara-eco', 'chat', 'tutor', 'generate');
  try { return JSON.parse(response.response || "[]"); } catch (e) { return []; }
};

export const generateStudyPlan = async (topic: string, hours: number) => {
  const response = await sendMessageToBackend(`7 day plan for ${topic}, ${hours} hrs/day. Output ONLY raw JSON.`, 'zara-eco', 'chat', 'tutor', 'generate');
  try { return JSON.parse(response.response || "{}"); } catch (e) { return {}; }
};

export const getBreakingNews = async () => {
  const ai = getAI();
  const response = await withRetry(() => ai.models.generateContent({ model: DEFAULT_MODEL, contents: "Give me the latest global breaking news in a short, readable digest.", config: { systemInstruction: ZARA_CORE_IDENTITY, tools: [{ googleSearch: {} }] } })) as GenerateContentResponse;
  const sources: Source[] = [];
  response.candidates?.[0]?.groundingMetadata?.groundingChunks?.forEach((c: any) => { if (c.web) sources.push({ title: c.web.title, uri: c.web.uri }); });
  return { text: response.text || "", sources };
};
