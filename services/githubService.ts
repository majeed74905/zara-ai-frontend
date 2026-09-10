// CRITICAL-1 FIX: Groq SDK removed from frontend — all AI calls proxied through backend.
// The backend holds the GROQ_API_KEY server-side. Never import groq-sdk in browser code.
import { sendMessageToBackend } from './chatService';
import { Message } from '../types';

export interface RepoNode {
    path: string;
    type: 'blob' | 'tree';
    sha?: string;
    size?: number;
    content?: string; // Optional cached content
}

export interface AnalysisStage {
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    message: string;
}

export interface RepoMeta {
    owner: string;
    repo: string;
    fullName: string;
    description: string | null;
    stars: number;
    forks: number;
    watchers: number;
    openIssues: number;
    language: string | null;
    topics: string[];
    defaultBranch: string;
    license: string | null;
    homepage: string | null;
    htmlUrl: string;
    ownerAvatar: string | null;
    pushedAt: string | null;
}

/** Parse "https://github.com/owner/repo(.git)?(/...)?" → { owner, repo } */
export const parseRepoUrl = (raw: string): { owner: string; repo: string } | null => {
    const clean = raw.trim().replace(/\/$/, '').replace(/\.git$/, '');
    const match = clean.match(/github\.com[/:]([^/]+)\/([^/?#]+)/i);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
};

/** Fetch repository metadata (stars, description, default branch, etc.) */
export const fetchRepoMeta = async (owner: string, repo: string): Promise<RepoMeta> => {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (res.status === 404) throw new Error("Repository not found. Check the URL — it must be a public repo.");
    if (res.status === 403) throw new Error("GitHub rate limit reached. Please try again in a few minutes.");
    if (!res.ok) throw new Error("Could not load repository. Is it public?");
    const d = await res.json();
    return {
        owner: d.owner?.login ?? owner,
        repo: d.name ?? repo,
        fullName: d.full_name ?? `${owner}/${repo}`,
        description: d.description ?? null,
        stars: d.stargazers_count ?? 0,
        forks: d.forks_count ?? 0,
        watchers: d.subscribers_count ?? d.watchers_count ?? 0,
        openIssues: d.open_issues_count ?? 0,
        language: d.language ?? null,
        topics: Array.isArray(d.topics) ? d.topics : [],
        defaultBranch: d.default_branch ?? 'main',
        license: d.license?.spdx_id ?? d.license?.name ?? null,
        homepage: d.homepage || null,
        htmlUrl: d.html_url ?? `https://github.com/${owner}/${repo}`,
        ownerAvatar: d.owner?.avatar_url ?? null,
        pushedAt: d.pushed_at ?? null,
    };
};

/** Heuristically detect the tech stack from the repo's file paths. */
export const detectTechStack = (filePaths: string[]): string[] => {
    const set = new Set<string>();
    const has = (needle: string) => filePaths.some(p => p.toLowerCase().includes(needle));
    const hasExt = (ext: string) => filePaths.some(p => p.toLowerCase().endsWith(ext));

    if (hasExt('.tsx') || hasExt('.jsx') || has('react')) set.add('React');
    if (hasExt('.ts') || hasExt('.tsx')) set.add('TypeScript');
    if (hasExt('.vue')) set.add('Vue');
    if (has('svelte')) set.add('Svelte');
    if (has('next.config')) set.add('Next.js');
    if (has('vite.config')) set.add('Vite');
    if (has('tailwind.config') || has('tailwind')) set.add('Tailwind');
    if (has('requirements.txt') || hasExt('.py')) set.add('Python');
    if (has('main.py') && (has('fastapi') || has('app/api'))) set.add('FastAPI');
    if (has('manage.py')) set.add('Django');
    if (has('package.json')) set.add('Node.js');
    if (has('server.js') || has('express')) set.add('Express');
    if (hasExt('.go') || has('go.mod')) set.add('Go');
    if (hasExt('.rs') || has('cargo.toml')) set.add('Rust');
    if (hasExt('.java') || has('pom.xml') || has('build.gradle')) set.add('Java');
    if (hasExt('.rb') || has('gemfile')) set.add('Ruby');
    if (hasExt('.php') || has('composer.json')) set.add('PHP');
    if (has('dockerfile') || has('docker-compose')) set.add('Docker');
    if (has('.github/workflows')) set.add('GitHub Actions');
    if (has('models/') || has('schema') || has('migrations') || has('alembic')) set.add('Database');
    if (has('postgres') || has('psycopg')) set.add('PostgreSQL');
    if (has('mongo')) set.add('MongoDB');
    if (hasExt('.sql')) set.add('SQL');

    return [...set];
};

/** Fetch the raw text content of a single file in the repo. */
export const fetchFileContent = async (
    owner: string,
    repo: string,
    path: string,
    branch: string = 'main'
): Promise<string> => {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`);
    if (!res.ok) throw new Error("Could not load file content.");
    return res.text();
};

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

// Helper to fetch valid tree from GitHub API.
// `branch` is tried first (use the repo's real default branch), then common fallbacks.
export const fetchGithubTree = async (owner: string, repo: string, branch: string = 'main'): Promise<RepoNode[]> => {
    // Try the provided/default branch first, then common fallbacks (de-duplicated).
    const branches = [...new Set([branch, 'main', 'master', 'develop', 'dev'])];
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
    return treeData
        .filter((node: RepoNode) => {
            const path = node.path;
            return !path.includes('node_modules') &&
                !path.includes('.git/') &&
                !path.includes('dist/') &&
                !path.includes('build/') &&
                !path.includes('package-lock.json') &&
                !path.includes('yarn.lock');
        })
        .map((node: any) => ({ path: node.path, type: node.type, sha: node.sha, size: node.size }));
};
