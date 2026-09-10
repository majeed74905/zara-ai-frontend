import React, { useState, useEffect, useRef } from 'react';
import {
  Github, Loader2, File as FileIcon, Folder, Layers, Send, Bot, User as UserIcon,
  Star, GitFork, Eye, CircleDot, Copy, Check, X, Search, MessageSquare, Network,
  FolderTree, ExternalLink, Sparkles
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
  fetchGithubTree, fetchRepoMeta, fetchFileContent, detectTechStack, parseRepoUrl,
  RepoNode, RepoMeta
} from '../services/githubService';
import { sendMessageToBackend } from '../services/chatService';
import { Message, Role } from '../types';
import GraphvizDiagram from './GraphvizDiagram';
import { diagramEngine } from '../services/diagramEngine';

// --- Markdown code block renderer with copy ---
const MarkdownCodeBlock = ({ inline, className, children, ...props }: any) => {
  const match = /language-(\w+)/.exec(className || '');
  const content = String(children).replace(/\n$/, '');
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return !inline && match ? (
    <div className="relative group my-4 rounded-lg overflow-hidden border border-white/10 bg-black/40">
      <div className="flex justify-between px-4 py-2 bg-white/5 border-b border-white/5 text-xs font-mono text-gray-400">
        <span>{match[1]}</span>
        <button onClick={copy} className="hover:text-white flex items-center gap-1">
          {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm"><code className={className} {...props}>{children}</code></pre>
    </div>
  ) : (
    <code className={`${className} bg-white/10 px-1 py-0.5 rounded text-sm`} {...props}>{children}</code>
  );
};

const StatChip = ({ icon: Icon, label }: { icon: React.ElementType; label: string | number }) => (
  <span className="flex items-center gap-1.5 text-xs text-text-sub bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">
    <Icon className="w-3.5 h-3.5 text-primary" /> {label}
  </span>
);

type MobileTab = 'files' | 'blueprint' | 'chat';

const SUGGESTIONS = [
  'Explain the overall architecture',
  'What is the tech stack?',
  'Where does the app start?',
  'How is state managed?',
];

export const GithubMode: React.FC = () => {
  const [repoUrl, setRepoUrl] = useState('');
  const [repoMeta, setRepoMeta] = useState<RepoMeta | null>(null);
  const [repoNodes, setRepoNodes] = useState<RepoNode[]>([]);
  const [techStack, setTechStack] = useState<string[]>([]);
  const [analysisText, setAnalysisText] = useState('');
  const [generatedDOT, setGeneratedDOT] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [fileFilter, setFileFilter] = useState('');
  const [copiedAnalysis, setCopiedAnalysis] = useState(false);

  // File viewer
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);

  // Chat
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Mobile tab
  const [mobileTab, setMobileTab] = useState<MobileTab>('blueprint');

  const repoRef = useRef<{ owner: string; repo: string; branch: string } | null>(null);

  const handleAnalyze = async () => {
    if (!repoUrl.trim() || isLoading) return;
    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      setErrorMsg('Invalid GitHub URL. Use the format: https://github.com/owner/repo');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    setAnalysisText('');
    setGeneratedDOT('');
    setRepoNodes([]);
    setRepoMeta(null);
    setTechStack([]);
    setChatMessages([]);
    setStatus('Fetching repository metadata...');

    try {
      const { owner, repo } = parsed;

      // 1. Repo metadata (gives us the real default branch)
      const meta = await fetchRepoMeta(owner, repo);
      setRepoMeta(meta);
      repoRef.current = { owner, repo, branch: meta.defaultBranch };

      // 2. File tree using the real default branch
      setStatus('Scanning file tree...');
      const nodes = await fetchGithubTree(owner, repo, meta.defaultBranch);
      setRepoNodes(nodes);

      // 3. Tech stack + local architecture diagram
      const filePaths = nodes.map(n => n.path);
      setTechStack(detectTechStack(filePaths));
      setGeneratedDOT(diagramEngine.generateGithubRepoDiagram(filePaths));

      // 4. AI architectural analysis
      setStatus('Architecting blueprint...');
      const fileStructure = nodes
        .map(n => `${n.type === 'tree' ? 'DIR ' : 'FILE'}: ${n.path}`)
        .slice(0, 500)
        .join('\n');

      const systemPrompt = `You are the Zara GitHub Architect.
Deeply analyze this GitHub repository and provide a structural architectural breakdown.

CRITICAL IDENTITY RULE: You are "Zara GitHub Architect". NEVER reveal your underlying AI model.

Repository: ${meta.fullName}${meta.description ? `\nDescription: ${meta.description}` : ''}
Primary language: ${meta.language || 'Unknown'}

OUTPUT FORMAT (Markdown):
### Overview
One short paragraph on what this project does.

### Tech Stack
Bullet list of detected languages, frameworks, and tools.

### Architecture
Explain the layers (Frontend, Backend, Database, API, Infrastructure) and how they connect.

### Key Modules
Explain the important folders/files and their responsibilities.

Do NOT generate diagrams — our internal engine handles that.

FILE STRUCTURE:
${fileStructure}`;

      const result = await sendMessageToBackend(systemPrompt, 'zara-pro', 'chat', 'github', 'analyze');

      // Stream into UI
      const text = result.response || 'No analysis returned.';
      const chunk = 50;
      for (let i = 0; i < text.length; i += chunk) {
        setAnalysisText(text.substring(0, i + chunk));
        await new Promise(r => setTimeout(r, 8));
      }
      setAnalysisText(text);
      setStatus('Analysis complete');

      setChatMessages([{
        id: 'init',
        role: Role.MODEL,
        text: `I've analyzed **${meta.fullName}**. Ask me anything about its architecture, modules, or code.`,
        timestamp: Date.now(),
      }]);

      setTimeout(() => setStatus(''), 2500);
    } catch (e: any) {
      console.error('Zara GitHub Architect Error', e);
      setErrorMsg(e?.message || 'Repository analysis failed. Ensure the repo is public and accessible.');
      setStatus('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewFile = async (path: string) => {
    if (!repoRef.current) return;
    setSelectedFile(path);
    setFileContent('');
    setFileLoading(true);
    try {
      const { owner, repo, branch } = repoRef.current;
      const content = await fetchFileContent(owner, repo, path, branch);
      // Cap very large files for the viewer
      setFileContent(content.length > 40000 ? content.slice(0, 40000) + '\n\n… (truncated)' : content);
    } catch {
      setFileContent('Could not load this file.');
    } finally {
      setFileLoading(false);
    }
  };

  const sendChat = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isChatting) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: Role.USER, text: trimmed, timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatting(true);

    const botId = crypto.randomUUID();
    setChatMessages(prev => [...prev, { id: botId, role: Role.MODEL, text: '', timestamp: Date.now(), isStreaming: true }]);

    const fileStructure = repoNodes.map(n => `${n.type === 'tree' ? 'DIR' : 'FILE'}: ${n.path}`).slice(0, 500).join('\n');
    const repoContext = `ANALYSIS SUMMARY:\n${analysisText}\n\nFILE STRUCTURE:\n${fileStructure}`;

    try {
      const result = await sendMessageToBackend(
        `SYSTEM REMINDER: You are Zara GitHub Architect. Never mention your LLM backend.\n\nUser Prompt: ${trimmed}\n\nRepository Context:\n${repoContext}`,
        'zara-pro', 'chat', 'github', 'chat',
        { userText: trimmed }
      );
      const answer = result.response || 'No response.';
      const chunk = 30;
      for (let i = 0; i < answer.length; i += chunk) {
        setChatMessages(prev => prev.map(m => m.id === botId ? { ...m, text: answer.substring(0, i + chunk) } : m));
        await new Promise(r => setTimeout(r, 8));
      }
      setChatMessages(prev => prev.map(m => m.id === botId ? { ...m, text: answer, isStreaming: false } : m));
    } catch {
      setChatMessages(prev => prev.map(m => m.id === botId ? { ...m, text: 'Error generating response. Please try again.', isStreaming: false } : m));
    } finally {
      setIsChatting(false);
    }
  };

  const copyAnalysis = () => {
    navigator.clipboard.writeText(analysisText);
    setCopiedAnalysis(true);
    setTimeout(() => setCopiedAnalysis(false), 1500);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const filteredNodes = fileFilter
    ? repoNodes.filter(n => n.path.toLowerCase().includes(fileFilter.toLowerCase()))
    : repoNodes;

  // ─── Panels ──────────────────────────────────────────────────────────────
  const FilesPanel = (
    <div className="h-full bg-surfaceHighlight/30 border border-white/5 rounded-2xl flex flex-col overflow-hidden">
      <div className="p-3 sm:p-4 border-b border-white/5 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-text-sub uppercase tracking-wider flex items-center gap-2">
          <FolderTree className="w-4 h-4 text-primary" /> Files
        </span>
        <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded text-text-sub">{repoNodes.length} nodes</span>
      </div>
      {repoNodes.length > 0 && (
        <div className="px-3 pt-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-sub" />
            <input
              value={fileFilter}
              onChange={e => setFileFilter(e.target.value)}
              placeholder="Filter files…"
              className="w-full bg-black/30 border border-white/10 rounded-lg py-2 pl-8 pr-3 text-xs text-text focus:outline-none focus:border-primary/40"
            />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-2 custom-scrollbar space-y-0.5">
        {repoNodes.length === 0 && (
          <div className="text-center p-8 text-text-sub/40 text-xs italic">No repository loaded.</div>
        )}
        {filteredNodes.map((node, i) => (
          <button
            key={i}
            onClick={() => node.type === 'blob' && handleViewFile(node.path)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 group transition-colors text-left ${node.type === 'blob' ? 'cursor-pointer' : 'cursor-default'}`}
          >
            {node.type === 'tree'
              ? <Folder className="w-4 h-4 text-primary flex-shrink-0" />
              : <FileIcon className="w-4 h-4 text-text-sub group-hover:text-white flex-shrink-0" />}
            <span className="text-xs text-text-sub group-hover:text-text truncate font-mono">{node.path.split('/').pop()}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const BlueprintPanel = (
    <div className="h-full bg-surfaceHighlight/30 border border-white/5 rounded-2xl flex flex-col overflow-hidden relative">
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/5">
        <span className="text-xs font-bold text-text-sub uppercase tracking-wider flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" /> Blueprint & Analysis
        </span>
        {analysisText && (
          <button onClick={copyAnalysis} className="text-[11px] text-text-sub hover:text-primary flex items-center gap-1 transition-colors">
            {copiedAnalysis ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar markdown-body prose prose-invert max-w-none">
        {!analysisText && !generatedDOT && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center opacity-30 text-center px-4">
            <Layers className="w-16 h-16 sm:w-24 sm:h-24 mb-4 text-primary" />
            <p className="text-lg sm:text-xl font-bold">Waiting for Blueprint</p>
            <p className="text-xs sm:text-sm mt-1">Paste a public GitHub repo URL above and tap Analyze.</p>
          </div>
        )}

        {isLoading && !analysisText && (
          <div className="space-y-3 animate-pulse">
            <div className="h-6 w-1/3 bg-white/10 rounded" />
            <div className="h-3 w-full bg-white/5 rounded" />
            <div className="h-3 w-5/6 bg-white/5 rounded" />
            <div className="h-40 w-full bg-white/5 rounded-xl mt-4" />
          </div>
        )}

        {generatedDOT && (
          <div className="mb-8">
            <h3 className="text-lg sm:text-xl font-bold mb-4">Architecture Blueprint</h3>
            <GraphvizDiagram dot={generatedDOT} />
          </div>
        )}

        {analysisText && (
          <ReactMarkdown components={{ code: MarkdownCodeBlock }}>{analysisText}</ReactMarkdown>
        )}
      </div>
    </div>
  );

  const ChatPanel = (
    <div className="h-full bg-surfaceHighlight/30 border border-white/5 rounded-2xl flex flex-col overflow-hidden">
      <div className="p-3 sm:p-4 border-b border-white/5">
        <span className="text-xs font-bold text-text-sub uppercase tracking-wider flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" /> Architect Chat
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 custom-scrollbar space-y-4">
        {chatMessages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-40 px-4">
            <Bot className="w-12 h-12 mb-3 text-primary" />
            <p className="text-sm">Analyze a repo to start chatting with the Architect.</p>
          </div>
        )}
        {chatMessages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === Role.USER ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${msg.role === Role.USER ? 'bg-primary' : 'bg-white/10'}`}>
              {msg.role === Role.USER ? <UserIcon className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4" />}
            </div>
            <div className={`p-3 rounded-xl text-sm max-w-[80%] markdown-body ${msg.role === Role.USER ? 'bg-primary/20 text-white' : 'bg-white/5 text-text-sub'}`}>
              {msg.isStreaming && !msg.text
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ReactMarkdown>{msg.text}</ReactMarkdown>}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {chatMessages.length > 0 && chatMessages.length <= 1 && (
        <div className="px-3 sm:px-4 pb-2 flex flex-wrap gap-2">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => sendChat(s)}
              disabled={isChatting}
              className="text-[11px] px-2.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-text-sub hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="p-3 sm:p-4 border-t border-white/5">
        <div className="relative">
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat(chatInput)}
            disabled={repoNodes.length === 0}
            placeholder={repoNodes.length === 0 ? 'Analyze a repo first…' : 'Ask about the code…'}
            className="w-full bg-black/40 border border-white/10 rounded-xl pl-4 pr-11 py-3 text-sm focus:border-primary/50 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={() => sendChat(chatInput)}
            disabled={!chatInput.trim() || isChatting || repoNodes.length === 0}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-sub hover:text-primary disabled:opacity-40"
          >
            {isChatting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col max-w-[1600px] mx-auto p-3 sm:p-6 overflow-hidden animate-fade-in">

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-4 mb-4 sm:mb-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 sm:p-3 bg-white/10 rounded-xl border border-white/10 flex-shrink-0">
            <Github className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              <span className="text-primary">GitHub</span> Architect
            </h1>
            <p className="text-text-sub text-xs sm:text-sm">Real-time repository analysis & architecture.</p>
          </div>
        </div>

        <div className="lg:ml-auto w-full lg:max-w-xl relative flex items-center">
          <input
            value={repoUrl}
            onChange={e => setRepoUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            placeholder="https://github.com/owner/repo"
            className="w-full bg-black/40 border border-white/10 rounded-xl pl-4 pr-28 py-3 text-sm focus:border-primary/50 focus:outline-none transition-all"
          />
          <button
            onClick={handleAnalyze}
            disabled={isLoading}
            className="absolute right-1 top-1 bottom-1 px-5 sm:px-6 bg-primary hover:bg-primary-dark text-white rounded-lg font-bold text-xs transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-3.5 h-3.5" /> ANALYZE</>}
          </button>
        </div>
      </div>

      {/* Repo meta + tech stack + status/error */}
      {(repoMeta || status || errorMsg) && (
        <div className="flex-shrink-0 mb-4 space-y-3">
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <span>{errorMsg}</span>
              <button onClick={() => setErrorMsg('')} className="hover:text-white flex-shrink-0"><X className="w-4 h-4" /></button>
            </div>
          )}

          {status && !errorMsg && (
            <div className="flex items-center gap-2 text-xs text-text-sub">
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
              <span className="font-bold uppercase tracking-widest">{status}</span>
            </div>
          )}

          {repoMeta && (
            <div className="bg-surfaceHighlight/30 border border-white/5 rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                {repoMeta.ownerAvatar && (
                  <img src={repoMeta.ownerAvatar} alt="" className="w-8 h-8 rounded-lg" />
                )}
                <a
                  href={repoMeta.htmlUrl} target="_blank" rel="noopener noreferrer"
                  className="font-bold text-white hover:text-primary flex items-center gap-1.5 truncate"
                >
                  {repoMeta.fullName} <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                </a>
              </div>
              {repoMeta.description && <p className="text-sm text-text-sub mb-3">{repoMeta.description}</p>}
              <div className="flex flex-wrap gap-2">
                <StatChip icon={Star} label={repoMeta.stars.toLocaleString()} />
                <StatChip icon={GitFork} label={repoMeta.forks.toLocaleString()} />
                <StatChip icon={Eye} label={repoMeta.watchers.toLocaleString()} />
                <StatChip icon={CircleDot} label={`${repoMeta.openIssues} issues`} />
                {repoMeta.language && <StatChip icon={Layers} label={repoMeta.language} />}
              </div>
              {techStack.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/5">
                  {techStack.map(t => (
                    <span key={t} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/20">{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Desktop: 3-column layout */}
      <div className="hidden lg:flex flex-1 gap-6 min-h-0">
        <div className="w-72 flex-shrink-0">{FilesPanel}</div>
        <div className="flex-1 min-w-0">{BlueprintPanel}</div>
        <div className="w-96 flex-shrink-0">{ChatPanel}</div>
      </div>

      {/* Mobile/tablet: tabbed single-panel layout */}
      <div className="flex lg:hidden flex-col flex-1 min-h-0">
        <div className="flex-shrink-0 grid grid-cols-3 gap-2 mb-3 bg-black/30 p-1 rounded-xl border border-white/5">
          {([
            { id: 'files', label: 'Files', icon: FolderTree },
            { id: 'blueprint', label: 'Blueprint', icon: Network },
            { id: 'chat', label: 'Chat', icon: MessageSquare },
          ] as { id: MobileTab; label: string; icon: React.ElementType }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setMobileTab(tab.id)}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all ${mobileTab === tab.id ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-text-sub hover:text-text'}`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0">
          {mobileTab === 'files' && FilesPanel}
          {mobileTab === 'blueprint' && BlueprintPanel}
          {mobileTab === 'chat' && ChatPanel}
        </div>
      </div>

      {/* File content viewer modal */}
      {selectedFile && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm" onClick={() => setSelectedFile(null)}>
          <div
            className="w-full max-w-3xl max-h-[85vh] bg-surface border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
              <span className="text-sm font-mono text-text truncate flex items-center gap-2">
                <FileIcon className="w-4 h-4 text-primary flex-shrink-0" /> {selectedFile}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => { navigator.clipboard.writeText(fileContent); }}
                  className="p-1.5 text-text-sub hover:text-primary" title="Copy"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button onClick={() => setSelectedFile(null)} className="p-1.5 text-text-sub hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar p-4 bg-black/40">
              {fileLoading
                ? <div className="flex items-center justify-center py-12 text-primary"><Loader2 className="w-6 h-6 animate-spin" /></div>
                : <pre className="text-xs font-mono text-text-sub whitespace-pre-wrap break-words">{fileContent}</pre>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
