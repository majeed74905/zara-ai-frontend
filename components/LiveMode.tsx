
import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Radio, AlertTriangle, User, Sparkles, Activity, WifiOff, X, Music, Youtube, RefreshCw, ExternalLink, Loader2, Key } from 'lucide-react';
import { Modality, LiveServerMessage } from "@google/genai";
import { buildSystemInstruction, MEDIA_PLAYER_TOOL } from '../services/gemini';
import { LiveSessionManager } from '../services/LiveSessionManager';
import { API_URL } from '../services/apiConfig';
import { float32ToInt16, base64ToUint8Array, decodeAudioData, arrayBufferToBase64 } from '../utils/audioUtils';
import { PersonalizationConfig, MediaAction, Message, Role } from '../types';

interface LiveModeProps {
  personalization: PersonalizationConfig;
  /** Selected Zara model in Chat (zara-fast | zara-pro | zara-eco) — Live uses the same personality. */
  chatModel?: string;
  /** Current chat conversation, so Live can continue it. */
  recentContext?: Message[];
  /** Zara Care (emotional companion) is active in Chat — Live keeps it. */
  careMode?: boolean;
}

interface LiveMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

const MODEL_LABELS: Record<string, string> = {
  'zara-fast': 'Zara Fast',
  'zara-pro': 'Zara Pro',
  'zara-eco': 'Zara Eco',
};

// Used only when the backend persona endpoint is unreachable
const FALLBACK_VOICE_RULES = `
## VOICE CONVERSATION (LIVE MODE)
You are talking out loud in real time. Short spoken sentences, no markdown, no lists, no emojis, no URLs read aloud.
Keep turns short so the user can jump in; if interrupted, respond to what they just said.
Understand what they're doing (greeting, small talk, sharing a feeling, asking something) and reply proportionally — a greeting gets a short, natural greeting back in their language and energy (never a scripted line, never "How can I assist you?"). If they ask how you are, say you're good and ask them back. If they greet and then ask something, greet in a word and answer it.

## SPOKEN LANGUAGE LOCK
Reply in the SAME language and style the user is speaking on every turn — Tamil, Tanglish, Hindi, Hinglish, Malayalam, Kannada, Telugu, English or any other. Switch immediately when they switch. Never default to English for a non-English speaker.`;

const friendlyLiveError = (err: any): { message: string } => {
  const name = err?.name || '';
  const raw = String(err?.message || err || '').toLowerCase();
  if (name === 'NotAllowedError' || name === 'SecurityError' || raw.includes('permission denied')) {
    return { message: "Microphone access is blocked. Allow mic permission for this site in your browser, then tap Reconnect." };
  }
  if (name === 'NotFoundError' || raw.includes('requested device not found')) {
    return { message: "No microphone found. Connect a mic and try again." };
  }
  if (name === 'NotReadableError') {
    return { message: "Your microphone is being used by another app. Close it and try again." };
  }
  if (raw.includes('requested entity was not found') || raw.includes('api key') || raw.includes('permission_denied')
      || raw.includes('unauthenticated') || raw.includes('live voice')) {
    return { message: "Live voice isn't available right now. Please try again in a moment." };
  }
  if (raw.includes('quota') || raw.includes('resource_exhausted') || raw.includes('429')) {
    return { message: "The voice service is busy or out of quota right now. Please try again in a minute." };
  }
  if (!navigator.onLine || raw.includes('network') || raw.includes('failed to fetch')) {
    return { message: "Connection lost. Check your internet and tap Reconnect." };
  }
  return { message: "Couldn't keep the voice session running. Tap Reconnect to try again." };
};

const toContextTurns = (messages?: Message[]) =>
  (messages || [])
    .filter(m => !m.isError && !m.isStreaming && m.text?.trim())
    .slice(-8)
    .map(m => ({ role: m.role === Role.USER ? 'user' : 'assistant', content: m.text.slice(0, 1500) }));

const fetchVoicePersona = async (model: string, recentContext: Message[] | undefined, careMode: boolean): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${API_URL}/ai/persona`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        interaction_mode: careMode ? 'care' : 'chat',
        recent_context: toContextTurns(recentContext),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.system_instruction === 'string' ? data.system_instruction : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Short-lived, single-use Gemini Live token minted by OUR backend from its own key.
 * The real API key never reaches the browser, and users never have to paste one.
 */
const fetchLiveToken = async (): Promise<{ token: string; model: string }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_URL}/ai/live-token`, { method: 'POST', signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token || !data?.model) {
      throw new Error(data?.detail || 'Live voice is unavailable right now.');
    }
    return { token: data.token, model: data.model };
  } finally {
    clearTimeout(timer);
  }
};

interface ProsodySample {
  energy: number | null;
  speech_rate: number | null;
  avg_pause_ms: number | null;
  long_pauses: number;
  duration_ms: number;
  interrupted: boolean;
  laughter: boolean;
}

/**
 * Ask the backend how to handle the next turn, given what was said and how it sounded.
 * Returns a short internal note (never spoken) or null if unavailable.
 */
const fetchTurnNote = async (
  transcript: string,
  prosody: ProsodySample,
  model: string,
  careMode: boolean,
  recent: LiveMessage[]
): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${API_URL}/ai/live-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        model,
        interaction_mode: careMode ? 'care' : 'chat',
        prosody,
        recent_context: recent.slice(-6).map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text.slice(0, 800),
        })),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.note === 'string' ? data.note : null;
  } catch {
    return null;   // voice keeps working without the hint
  } finally {
    clearTimeout(timer);
  }
};

export const LiveMode: React.FC<LiveModeProps> = ({ personalization, chatModel = 'zara-fast', recentContext, careMode = false }) => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [volume, setVolume] = useState(0);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mediaCard, setMediaCard] = useState<MediaAction | null>(null);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);

  // Refs for connection management
  const isMountedRef = useRef(true);
  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const userEndedRef = useRef(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const nextStartTimeRef = useRef<number>(0);
  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const processingQueueRef = useRef<Promise<void>>(Promise.resolve());
  // When true, the next transcription chunk starts a new bubble (turn finished or interrupted)
  const turnBoundaryRef = useRef(true);

  // Prosody for the turn in progress: HOW they're speaking, measured from the mic stream.
  // Audio itself is never stored or sent anywhere — only these aggregate numbers.
  const VOICE_THRESHOLD = 0.02;          // RMS above this counts as speech
  const FRAME_MS = (2048 / 16000) * 1000; // one ScriptProcessor block ≈ 128ms
  const turnAudioRef = useRef({ energySum: 0, voicedFrames: 0, silentRun: 0, pauses: [] as number[] });
  const userTurnTextRef = useRef('');
  const interruptedRef = useRef(false);

  const resetTurnAudio = () => {
    turnAudioRef.current = { energySum: 0, voicedFrames: 0, silentRun: 0, pauses: [] };
    userTurnTextRef.current = '';
    interruptedRef.current = false;
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const modelLabel = `${MODEL_LABELS[chatModel] || 'Zara'}${careMode ? ' · Care' : ''}`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const cleanup = (finalStatus: string = 'Ready') => {
    setIsActive(false);

    if (liveSessionRef.current) {
      liveSessionRef.current.disconnect();
      liveSessionRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) { }
      });
      mediaStreamRef.current = null;
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      } catch (e) { }
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) { }
      audioContextRef.current = null;
    }
    if (inputAudioContextRef.current) {
      try { inputAudioContextRef.current.close(); } catch (e) { }
      inputAudioContextRef.current = null;
    }

    audioQueueRef.current.forEach(source => {
      try { source.stop(); } catch (e) { }
    });
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
    turnBoundaryRef.current = true;

    processingQueueRef.current = Promise.resolve();

    if (isMountedRef.current) {
      setIsAiSpeaking(false);
      setVolume(0);
      setStatus(finalStatus);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, []);

  const downsampleBuffer = (buffer: Float32Array, inputRate: number, outputRate: number) => {
    if (outputRate === inputRate) return buffer;
    const ratio = inputRate / outputRate;
    const newLength = Math.floor(buffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const offset = Math.floor(i * ratio);
      result[i] = buffer[offset];
    }
    return result;
  };

  const schedulePlayback = (buffer: AudioBuffer) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 1.0;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextStartTimeRef.current < now) {
      nextStartTimeRef.current = now + 0.1;
    }

    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;

    if (isMountedRef.current) setIsAiSpeaking(true);
    audioQueueRef.current.push(source);

    source.onended = () => {
      const idx = audioQueueRef.current.indexOf(source);
      if (idx > -1) audioQueueRef.current.splice(idx, 1);
      if (audioQueueRef.current.length === 0 && isMountedRef.current) {
        setIsAiSpeaking(false);
      }
    };
  };

  const reportError = (err: any) => {
    const { message } = friendlyLiveError(err);
    console.error("Live session error:", err);
    if (isMountedRef.current) setError(message);
  };

  const appendTranscript = (role: 'user' | 'model', text: string) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && !turnBoundaryRef.current) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      turnBoundaryRef.current = false;
      return [...prev, { id: crypto.randomUUID(), role, text }];
    });
  };

  // Latest transcript list, readable from inside audio/session callbacks
  const messagesRef = useRef<LiveMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  /**
   * Zara finished a turn: summarise how the user spoke, ask the backend how to handle
   * the next turn, and push that back as a silent note. Failures are ignored —
   * the voice session keeps working without the hint.
   */
  const finalizeUserTurn = async () => {
    const transcript = userTurnTextRef.current.trim();
    const a = turnAudioRef.current;
    const interrupted = interruptedRef.current;
    resetTurnAudio();
    if (!transcript || a.voicedFrames < 3) return;

    const voicedMs = a.voicedFrames * FRAME_MS;
    const words = transcript.split(/\s+/).filter(Boolean).length;
    const prosody: ProsodySample = {
      energy: a.voicedFrames ? Math.min(1, a.energySum / a.voicedFrames / 0.15) : null,
      speech_rate: voicedMs > 0 ? words / (voicedMs / 1000) : null,
      avg_pause_ms: a.pauses.length ? a.pauses.reduce((s, p) => s + p, 0) / a.pauses.length : null,
      long_pauses: a.pauses.filter(p => p >= 900).length,
      duration_ms: voicedMs,
      interrupted,
      laughter: /😂|🤣|\b(?:haha+|hehe+|lol)\b/i.test(transcript),
    };

    const note = await fetchTurnNote(transcript, prosody, chatModel, careMode, messagesRef.current);
    if (note && liveSessionRef.current?.isConnected) {
      liveSessionRef.current.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: `[note] ${note}` }] }],
        turnComplete: false,   // context only — does not trigger a reply
      });
    }
  };

  const connect = async () => {
    if (!navigator.onLine) {
      setError("You're offline. Check your internet connection and try again.");
      return;
    }

    // Cleanup previous session if any
    cleanup();
    userEndedRef.current = false;

    setError(null);
    setIsActive(true);
    setStatus('Initializing...');

    try {
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      inputAudioContextRef.current = inputCtx;

      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = outputCtx;

      if (outputCtx.state === 'suspended') await outputCtx.resume();
      if (inputCtx.state === 'suspended') await inputCtx.resume();

      nextStartTimeRef.current = outputCtx.currentTime;

      // Echo cancellation keeps Zara from hearing (and answering) her own voice
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;

      const indiaTime = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'full',
        timeStyle: 'long'
      });

      setStatus('Connecting...');

      // Same Zara identity + selected model personality (+ Care) as Chat, with chat context
      const persona = await fetchVoicePersona(chatModel, recentContext, careMode)
        || `${buildSystemInstruction(personalization, undefined, careMode)}\n${FALLBACK_VOICE_RULES}`;

      if (!isMountedRef.current || inputCtx.state === 'closed') return;

      const nickname = personalization?.nickname ? `\n5. **USER NAME**: ${personalization.nickname}.` : '';
      const systemInstruction = `${persona}

**UP-TO-DATE CONTEXT (CRITICAL):**
1. **CURRENT TIME**: Today is ${indiaTime}.
2. **LOCATION**: User is in India.
3. **ACCURACY**: If the user asks for the date, day, or time, use the above information exactly.
4. **MEDIA**: When the user asks to play a song or video, use the play_media tool.${nickname}`;

      // Short-lived token from our backend — no API key in the browser, no key prompt
      const live = await fetchLiveToken();
      if (!isMountedRef.current || inputCtx.state === 'closed') return;

      const sessionManager = new LiveSessionManager(
        live.token,
        live.model,
        {
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [MEDIA_PLAYER_TOOL] }],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction,
        },
        {
          onOpen: () => {
            if (isMountedRef.current) setStatus('Listening');
          },
          onMessage: (message: LiveServerMessage) => {
            if (message.toolCall?.functionCalls) {
              for (const call of message.toolCall.functionCalls) {
                if (call.name === 'play_media') {
                  const args = call.args as any;
                  const url = args.platform === 'spotify'
                    ? `https://open.spotify.com/search/${encodeURIComponent(args.query)}`
                    : `https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`;

                  if (isMountedRef.current) setMediaCard({ ...args, action: 'PLAY_MEDIA', url });

                  sessionManager.sendToolResponse({
                    functionResponses: {
                      id: call.id,
                      name: call.name,
                      response: { result: "ok" }
                    }
                  });
                }
              }
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              const audioBytes = base64ToUint8Array(base64Audio);
              const decodingPromise = decodeAudioData(audioBytes, outputCtx, 24000, 1);
              processingQueueRef.current = processingQueueRef.current
                .then(() => decodingPromise)
                .then(buffer => schedulePlayback(buffer))
                .catch(() => { });
            }

            if (isMountedRef.current) {
              const inputText = message.serverContent?.inputTranscription?.text;
              const outputText = message.serverContent?.outputTranscription?.text;
              if (inputText) {
                appendTranscript('user', inputText);
                userTurnTextRef.current += inputText;
              }
              if (outputText) appendTranscript('model', outputText);
            }

            if (message.serverContent?.turnComplete) {
              turnBoundaryRef.current = true;
              void finalizeUserTurn();   // queue a silent hint for the next turn
            }

            if (message.serverContent?.interrupted) {
              // User started talking: stop Zara immediately so she never talks over them
              interruptedRef.current = true;
              processingQueueRef.current = Promise.resolve();
              audioQueueRef.current.forEach(s => { try { s.stop(); } catch (e) { } });
              audioQueueRef.current = [];
              if (audioContextRef.current) nextStartTimeRef.current = audioContextRef.current.currentTime;
              turnBoundaryRef.current = true;
              if (isMountedRef.current) setIsAiSpeaking(false);
            }
          },
          onError: (e: any) => {
            reportError(e);
            cleanup('Disconnected');
          },
          onClose: (e: CloseEvent) => {
            console.log(`Live API Closed: Code=${e.code}, Reason=${e.reason}, Clean=${e.wasClean}`);
            if (!userEndedRef.current && isMountedRef.current) {
              if (e.code !== 1000) {
                reportError({ message: e.reason || 'network' });
              } else {
                setError("The voice session ended. Tap Reconnect to continue.");
              }
            }
            cleanup(userEndedRef.current ? 'Ready' : 'Disconnected');
          }
        },
        'v1alpha'   // ephemeral tokens require the v1alpha API
      );

      liveSessionRef.current = sessionManager;

      await sessionManager.connect();

      if (!isMountedRef.current || inputCtx.state === 'closed' || !sessionManager.isConnected) {
        return;
      }

      try {
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;
        source.connect(processor);
        processor.connect(inputCtx.destination);

        processor.onaudioprocess = (e) => {
          if (!isMountedRef.current || !liveSessionRef.current) return;
          let inputData = e.inputBuffer.getChannelData(0);

          let sum = 0;
          for (let i = 0; i < inputData.length; i += 16) sum += inputData[i] * inputData[i];
          const rms = Math.sqrt(sum / (inputData.length / 16));
          setVolume(rms * 5);

          // How they're speaking: loudness, pauses, speaking time. Aggregates only — no audio kept.
          const ta = turnAudioRef.current;
          if (rms > VOICE_THRESHOLD) {
            if (ta.silentRun > 0) {
              const pauseMs = ta.silentRun * FRAME_MS;
              if (ta.voicedFrames > 0 && pauseMs >= 250) ta.pauses.push(pauseMs);
              ta.silentRun = 0;
            }
            ta.voicedFrames += 1;
            ta.energySum += rms;
          } else if (ta.voicedFrames > 0) {
            ta.silentRun += 1;
          }

          if (inputCtx.sampleRate !== 16000) {
            inputData = downsampleBuffer(inputData, inputCtx.sampleRate, 16000);
          }
          const pcmData = float32ToInt16(inputData);
          const pcmBase64 = arrayBufferToBase64(pcmData.buffer);

          liveSessionRef.current?.sendRealtimeInput({
            media: { mimeType: 'audio/pcm;rate=16000', data: pcmBase64 }
          });
        };
      } catch (nodeErr) {
        console.warn("Audio processing node setup skipped (context closed or unavailable):", nodeErr);
      }

    } catch (e: any) {
      reportError(e);
      cleanup('Disconnected');
    }
  };

  const endSession = () => {
    userEndedRef.current = true;
    cleanup('Ready');
  };

  const toggleConnection = () => {
    if (isActive) {
      endSession();
    } else {
      connect();
    }
  };

  return (
    <div className="h-full flex flex-col relative overflow-hidden animate-fade-in">

      {/* Header Visualizer */}
      <div className={`flex-shrink-0 flex flex-col items-center justify-center transition-all duration-300 bg-gradient-to-b from-surfaceHighlight/30 to-transparent ${messages.length > 0 ? 'h-[180px]' : 'h-[300px]'}`}>

        <div className="flex items-center gap-3 mb-8 px-4" role="status" aria-live="polite">
          <div className={`w-2.5 h-2.5 flex-shrink-0 rounded-full shadow-[0_0_10px_currentColor] ${isActive ? 'bg-green-500 text-green-500 animate-pulse' : error ? 'bg-red-500 text-red-500' : 'bg-gray-400 text-gray-400'}`} />
          <div className="text-text-sub font-mono text-sm flex items-center gap-2">
            {error ? (
              <span className="text-red-400 font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </span>
            ) : (isAiSpeaking ? (
              <span className="text-primary font-bold flex items-center gap-1.5">
                <Activity className="w-4 h-4 animate-bounce" />
                {modelLabel} is speaking...
              </span>
            ) : (
              <span className="flex items-center gap-2 font-medium">
                {(status === 'Connecting...' || status === 'Initializing...') && <Loader2 className="w-3 h-3 animate-spin" />}
                <span className="opacity-70">{status}</span>
                <span className="opacity-40 text-xs">· {modelLabel}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Pulse Visualizer */}
        <div className="relative flex items-center justify-center" aria-hidden="true">
          <div className={`absolute left-1/2 top-1/2 -ml-24 -mt-24 rounded-full border border-primary/20 transition-transform duration-[50ms] ease-linear will-change-transform`}
            style={{ width: '192px', height: '192px', transform: `scale(${1 + volume * 0.3})` }} />

          <div className={`absolute left-1/2 top-1/2 -ml-20 -mt-20 rounded-full border border-accent/30 transition-transform duration-[75ms] ease-linear will-change-transform`}
            style={{ width: '160px', height: '160px', transform: `scale(${1 + volume * 0.5})`, opacity: 0.5 }} />

          <div
            className={`w-32 h-32 rounded-full bg-gradient-to-br transition-all duration-100 ease-out shadow-[0_0_50px_rgba(139,92,246,0.5)] will-change-transform ${isAiSpeaking ? 'from-accent to-purple-600 scale-110 shadow-[0_0_80px_rgba(217,70,239,0.8)]' : 'from-primary to-accent blur-md'
              }`}
            style={{
              transform: isAiSpeaking ? `scale(${1.1 + volume * 0.2})` : `scale(${0.9 + volume * 0.6})`,
              opacity: isActive ? 0.9 : 0.3
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {navigator.onLine ? (
              <Radio className={`w-10 h-10 text-white transition-opacity ${isActive ? 'opacity-100' : 'opacity-50'}`} />
            ) : (
              <WifiOff className="w-10 h-10 text-white/50" />
            )}
          </div>
        </div>
      </div>

      {/* Media Card Overlay */}
      {mediaCard && isActive && (
        <div className="absolute top-4 left-4 right-4 z-50 flex justify-center animate-fade-in pointer-events-none">
          <div className="pointer-events-auto bg-surface/90 backdrop-blur-md border border-primary/30 rounded-2xl p-4 flex items-center gap-4 shadow-xl max-w-md w-full">
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center text-red-500">
              {mediaCard.platform === 'spotify' ? <Music className="w-6 h-6 text-green-500" /> : <Youtube className="w-6 h-6" />}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-text truncate">{mediaCard.title}</h4>
              <p className="text-xs text-text-sub truncate">
                {mediaCard.artist || `Playing on ${mediaCard.platform === 'spotify' ? 'Spotify' : 'YouTube'}`}
              </p>
            </div>
            <a
              href={mediaCard.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary hover:bg-primary-dark text-white p-3 rounded-full shadow-lg"
              aria-label={`Open ${mediaCard.title}`}
            >
              <ExternalLink className="w-5 h-5" />
            </a>
            <button onClick={() => setMediaCard(null)} className="text-text-sub hover:text-text p-1" aria-label="Dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Transcription Messages */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 space-y-4 relative custom-scrollbar" aria-live="polite">
        {messages.length === 0 && isActive && (
          <div className="text-center text-text-sub/40 mt-10 animate-pulse">
            <p>Go ahead, I'm listening — speak in any language.</p>
          </div>
        )}
        {messages.length === 0 && !isActive && !error && (
          <div className="text-center text-text-sub/50 mt-10 text-sm px-6">
            <p>Talk to {modelLabel} out loud. English, Tamil, Tanglish, Hindi and more — Zara replies in the language you speak.</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
            <div className={`flex max-w-[85%] gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border border-border ${msg.role === 'user' ? 'bg-surfaceHighlight' : 'bg-primary/20'}`}>
                {msg.role === 'user' ? <User className="w-4 h-4 text-text" /> : <Sparkles className="w-4 h-4 text-primary" />}
              </div>
              <div className={`px-4 py-2.5 rounded-2xl text-[15px] shadow-sm ${msg.role === 'user'
                ? 'bg-surfaceHighlight text-text rounded-tr-sm'
                : 'bg-gradient-to-br from-surface/40 to-surface/10 backdrop-blur-sm text-text rounded-tl-sm'
                }`}>
                {msg.text}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer Controls */}
      <div className="flex-shrink-0 p-6 bg-surface/30 backdrop-blur border-t border-border flex flex-col items-center gap-3">
        {error && !isActive && (
          <button onClick={() => { setError(null); connect(); }} className="flex items-center gap-2 text-xs bg-surfaceHighlight hover:bg-surface px-4 py-2 rounded-lg border border-white/10 mb-2">
            <RefreshCw className="w-3 h-3" /> Reconnect
          </button>
        )}

        <button
          onClick={toggleConnection}
          className={`px-10 py-4 rounded-full font-bold text-lg transition-all flex items-center gap-3 shadow-xl transform active:scale-95 ${isActive
            ? 'bg-red-500 text-white hover:bg-red-600 shadow-red-500/30'
            : 'bg-text text-background hover:opacity-90'
            }`}
        >
          {isActive ? (
            <><MicOff className="w-6 h-6" /> End Session</>
          ) : (
            <><Mic className="w-6 h-6" /> Start Live</>
          )}
        </button>
      </div>

    </div>
  );
};