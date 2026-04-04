// CRITICAL-1 FIX: Groq SDK removed from frontend — all AI calls proxied through backend.
// The backend holds the GROQ_API_KEY server-side. Never import groq-sdk in browser code.
import { sendMessageToBackend } from './chatService';
import { Message } from '../types';

export interface RepoNode {
    path: string;
    type: 'blob' | 'tree';
    sha?: string;
    content?: string; // Optional cached content
}

export interface AnalysisStage {
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    message: string;
}

export const analyzeRepoStream = async (
    repoContext: string,
    onToken: (token: string) => void,
    onStatus: (stage: string) => void
) => {
    const systemPrompt = `You are a Principal Software Architect AI.
Your goal is to deeply analyze a GitHub repository structure and provide a comprehensive architectural breakdown.

OUTPUT FORMAT: Markdown with clear sections.
1. **High-Level Overview**: What does this project do?
2. **Tech Stack**: Detect languages, frameworks, and tools.
3. **Architecture Diagram**: Describe the data flow and structure. Only generate Graphviz DOT diagrams.
4. **Key Modules**: Explain the folder structure logic.
5. **Code Quality**: Identify patterns and anti-patterns.

Be concise, professional, and insightful. Start analyzing based on the provided file tree and manifest.`;

    try {
        onStatus("Initializing Repository Analysis...");

        const prompt = `${systemPrompt}\n\nAnalyze this repository structure:\n\n${repoContext}`;
        const result = await sendMessageToBackend(prompt, 'zara-fast', 'chat', 'code_architect', 'analyze');

        onStatus("Streaming Analysis...");

        // Simulate streaming for UI smoothness
        const text = result.response || '';
        const chunkSize = 30;
        for (let i = 0; i < text.length; i += chunkSize) {
            onToken(text.substring(0, i + chunkSize));
            await new Promise(r => setTimeout(r, 15));
        }
        onToken(text); // Ensure full text is set

        onStatus("Analysis Complete");
    } catch (error: any) {
        console.error("Repo Analysis Error:", error);
        onToken(`\n\n**Analysis Error**: ${error.message}`);
        onStatus("Failed");
    }
};

export const chatWithRepoStream = async (
    history: Message[],
    repoContext: string,
    onToken: (token: string) => void
) => {
    const lastMessage = history[history.length - 1]?.text || '';
    const prompt = `You are the Maintainer AI for this repository.
Context contains the file structure and analysis of the repo.
Answer the user's questions specifically about this codebase.

REPO CONTEXT:
${repoContext.slice(0, 10000)}

USER QUESTION: ${lastMessage}`;

    try {
        const result = await sendMessageToBackend(prompt, 'zara-fast', 'chat', 'code_architect', 'analyze');
        const text = result.response || '';

        // Simulate streaming for UI smoothness
        const chunkSize = 20;
        for (let i = 0; i < text.length; i += chunkSize) {
            onToken(text.substring(0, i + chunkSize));
            await new Promise(r => setTimeout(r, 10));
        }
        onToken(text);
    } catch (error: any) {
        console.error("Repo Chat Error:", error);
        onToken(`\n*Error generating response: ${error.message}*`);
    }
};

// Helper to fetch valid tree from GitHub API
export const fetchGithubTree = async (owner: string, repo: string, branch: string = 'main'): Promise<RepoNode[]> => {
    // Try main then master then dev
    const branches = ['main', 'master', 'dev'];
    let treeData = null;

    for (const b of branches) {
        try {
            const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${b}?recursive=1`);
            if (res.ok) {
                const data = await res.json();
                treeData = data.tree;
                break;
            }
        } catch (e) { }
    }

    if (!treeData) throw new Error("Could not fetch repository tree. Is it public?");

    // Specific filtering for relevance
    return treeData.filter((node: RepoNode) => {
        const path = node.path;
        return !path.includes('node_modules') &&
            !path.includes('.git/') &&
            !path.includes('dist/') &&
            !path.includes('build/') &&
            !path.includes('package-lock.json') &&
            !path.includes('yarn.lock');
    });
};
