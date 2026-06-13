import mammoth from 'mammoth';
import pdfParse from '@cedrugs/pdf-parse';
import {
  config,
  DEFAULT_MAX_EMBEDDING_CANDIDATES,
  DEFAULT_MAX_RETRIEVED_CHARS,
  DEFAULT_MAX_RETRIEVED_CHUNKS
} from './config.js';
import { embedTexts, rankByEmbeddingSimilarity } from './embeddings.js';
import { logger, summarizeText } from './logger.js';
import type { EmbeddingConfig } from './types.js';

export type SourceInputs = {
  sourceText?: string;
  githubRepoUrl?: string;
  documents?: Express.Multer.File[];
};

type SourceDocument = {
  id: string;
  label: string;
  text: string;
};

type ScoredChunk = {
  label: string;
  score: number;
  lexicalScore: number;
  semanticScore?: number;
  text: string;
};

const MAX_SOURCE_TEXT_CHARS = 250_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REPO_FILES_TO_FETCH = 240;
const MAX_REPO_TOTAL_CHARS = 900_000;
const CHUNK_SIZE = 1400;
const CHUNK_OVERLAP = 180;

const textExtensions = new Set([
  '.txt', '.md', '.mdx', '.csv', '.json', '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.xml', '.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.go', '.rs',
  '.rb', '.php', '.c', '.h', '.cpp', '.hpp', '.cs', '.kt', '.swift', '.scala', '.sh', '.sql',
  '.dart', '.vue', '.svelte', '.ipynb'
]);

const excludedPathParts = [
  'node_modules/', '.git/', 'dist/', 'build/', '.next/', 'coverage/', 'vendor/',
  'target/', '.venv/', '__pycache__/', 'binary/', 'binaries/'
];

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : '';
}

function trimForBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)}\n\n[truncated]`;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function isProbablyText(contentType: string | null, path: string): boolean {
  const ext = fileExtension(path);
  if (textExtensions.has(ext) || ext === '.pdf' || ext === '.docx') return true;
  if (!contentType) return false;
  return contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml');
}

function splitIntoChunks(text: string, maxChars = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const paragraphs = normalized.split('\n\n');
  const chunks: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    if (!current) {
      current = p;
      continue;
    }

    if ((current.length + 2 + p.length) <= maxChars) {
      current = `${current}\n\n${p}`;
      continue;
    }

    chunks.push(current);
    const tail = current.slice(Math.max(0, current.length - overlap));
    current = tail ? `${tail}\n\n${p}` : p;

    if (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars));
      current = current.slice(maxChars - overlap);
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function extractTextFromBuffer(fileName: string, mimeType: string | undefined, buffer: Buffer): Promise<string> {
  const ext = fileExtension(fileName);

  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const parsed = await pdfParse(buffer);
    return parsed.text ?? '';
  }

  if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value;
  }

  return buffer.toString('utf-8');
}

function parseGitHubRepoUrl(url: string): { owner: string; repo: string; ref?: string; } | null {
  const match = url.trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/tree\/([^/?#]+))?/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ''),
    ref: match[3]
  };
}

function isAllowedRepoPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (excludedPathParts.some((p) => lower.includes(p))) return false;
  return textExtensions.has(fileExtension(lower));
}

function scorePathPriority(path: string): number {
  const lower = path.toLowerCase();
  let score = 0;
  if (lower.includes('readme')) score += 8;
  if (lower.includes('/docs/') || lower.startsWith('docs/')) score += 7;
  if (lower.includes('guide') || lower.includes('tutorial')) score += 4;
  if (lower.includes('src/')) score += 2;
  return score;
}

function scorePathByTopic(path: string, topicTerms: Set<string>): number {
  const pathTerms = tokenize(path);
  let score = 0;
  for (const t of pathTerms) {
    if (topicTerms.has(t)) score += 2;
  }
  return score;
}

const ALLOWED_FETCH_HOSTNAMES = new Set(['api.github.com', 'raw.githubusercontent.com']);

function assertAllowedUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!ALLOWED_FETCH_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(`Fetch to host '${parsed.hostname}' is not allowed`);
  }
}

async function fetchGitHubRepoDocuments(githubRepoUrl: string, topicTerms: Set<string>): Promise<SourceDocument[]> {
  const parsed = parseGitHubRepoUrl(githubRepoUrl);
  if (!parsed) {
    throw new Error('Invalid GitHub repository URL. Expected format: https://github.com/{owner}/{repo}[/tree/{ref}]');
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'quiz-gpt'
  };
  if (config.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${config.GITHUB_TOKEN}`;
  }

  const repoApiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  assertAllowedUrl(repoApiUrl);
  const repoRes = await fetch(repoApiUrl, { headers });
  if (!repoRes.ok) {
    throw new Error(`Unable to fetch repository metadata (${repoRes.status})`);
  }
  const repoJson = await repoRes.json() as { default_branch?: string; };
  const ref = parsed.ref ?? repoJson.default_branch;
  if (!ref) {
    throw new Error('Unable to detect repository default branch');
  }

  logger.info('github_repo.ingest_started', {
    owner: parsed.owner,
    repo: parsed.repo,
    ref,
    authenticated: Boolean(config.GITHUB_TOKEN)
  });

  const treeRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { headers });
  if (!treeRes.ok) {
    throw new Error(`Unable to fetch repository tree (${treeRes.status})`);
  }

  const treeJson = await treeRes.json() as {
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; size?: number; }>;
  };

  const candidates = (treeJson.tree ?? [])
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => ({
      path: entry.path as string,
      size: entry.size ?? 0,
      priority: scorePathPriority(entry.path as string),
      topicPathScore: scorePathByTopic(entry.path as string, topicTerms)
    }))
    .filter((entry) => isAllowedRepoPath(entry.path) && entry.size > 0 && entry.size <= MAX_FILE_BYTES)
    .sort((a, b) => {
      if (b.topicPathScore !== a.topicPathScore) return b.topicPathScore - a.topicPathScore;
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.size - b.size;
    })
    .slice(0, MAX_REPO_FILES_TO_FETCH);

  logger.info('github_repo.candidates_selected', {
    owner: parsed.owner,
    repo: parsed.repo,
    ref,
    treeTruncated: Boolean(treeJson.truncated),
    candidates: candidates.length
  });

  const repoDocs: SourceDocument[] = [];
  let totalChars = 0;

  for (const entry of candidates) {
    if (totalChars >= MAX_REPO_TOTAL_CHARS) break;

    const safeRef = ref.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    const safePath = entry.path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${safeRef}/${safePath}`;
    assertAllowedUrl(rawUrl);
    const fileRes = await fetch(rawUrl, { headers: { 'User-Agent': 'quiz-gpt' } });
    if (!fileRes.ok) continue;

    const contentType = fileRes.headers.get('content-type');
    if (!isProbablyText(contentType, entry.path)) continue;

    const raw = await fileRes.text();
    if (!raw.trim()) continue;

    const remaining = MAX_REPO_TOTAL_CHARS - totalChars;
    const text = trimForBudget(raw, Math.min(remaining, 30_000));
    totalChars += text.length;

    repoDocs.push({
      id: `repo:${entry.path}`,
      label: `repo:${entry.path}`,
      text
    });
  }

  if (!repoDocs.length) {
    throw new Error('No readable text files found in this repository');
  }

  logger.info('github_repo.ingest_completed', {
    owner: parsed.owner,
    repo: parsed.repo,
    documents: repoDocs.length,
    chars: totalChars
  });

  return repoDocs;
}

async function buildRetrievedContext(topic: string, settingsSummary: string, documents: SourceDocument[], cfg: typeof config, embeddingConfig: EmbeddingConfig | null): Promise<string> {
  const queryTerms = new Set(tokenize(`${topic} ${settingsSummary}`));
  const chunks: ScoredChunk[] = [];

  for (const doc of documents) {
    const docBoost = scorePathPriority(doc.label);
    const docChunks = splitIntoChunks(doc.text);

    for (const chunk of docChunks) {
      const terms = tokenize(chunk);
      const frequency = new Map<string, number>();
      for (const term of terms) {
        frequency.set(term, (frequency.get(term) ?? 0) + 1);
      }

      let overlap = 0;
      for (const q of queryTerms) {
        overlap += frequency.get(q) ?? 0;
      }

      const uniqueness = new Set(terms).size;
      const lexicalScore = (overlap * 6) + Math.min(uniqueness / 90, 2.5) + docBoost;
      if (lexicalScore <= docBoost) continue;

      chunks.push({
        label: doc.label,
        score: lexicalScore,
        lexicalScore,
        text: chunk
      });
    }
  }

  const maxCandidates = embeddingConfig?.maxCandidates ?? DEFAULT_MAX_EMBEDDING_CANDIDATES;
  const maxChunks = embeddingConfig?.maxRetrievedChunks ?? DEFAULT_MAX_RETRIEVED_CHUNKS;
  const maxChars = embeddingConfig?.maxRetrievedChars ?? DEFAULT_MAX_RETRIEVED_CHARS;

  const preSelected = chunks
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);

  if (!preSelected.length) return '';

  if (embeddingConfig) {
    try {
      const query = `Topic: ${topic}\nSettings: ${settingsSummary}`;
      const embeddings = await embedTexts([query, ...preSelected.map((chunk) => chunk.text)], embeddingConfig);
      const queryEmbedding = embeddings[0];
      const candidateEmbeddings = embeddings.slice(1);
      const semanticScores = rankByEmbeddingSimilarity(queryEmbedding, candidateEmbeddings);

      preSelected.forEach((chunk, idx) => {
        const semantic = semanticScores[idx] ?? 0;
        chunk.semanticScore = semantic;
        chunk.score = (semantic * 100) + chunk.lexicalScore;
      });
      logger.info('retrieval.embedding_ranked', {
        candidates: preSelected.length,
        embeddingStyle: embeddingConfig.provider,
        embeddingModel: embeddingConfig.modelId
      });
    } catch (error) {
      logger.warn('retrieval.embedding_failed_fallback_lexical', {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const selected = preSelected
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks);

  const sections: string[] = [];
  let total = 0;
  for (const chunk of selected) {
    const block = `Source: ${chunk.label}\n${chunk.text}`;
    if ((total + block.length) > maxChars) break;
    sections.push(block);
    total += block.length;
  }

  logger.info('retrieval.context_selected', {
    candidates: chunks.length,
    preSelected: preSelected.length,
    selected: sections.length,
    chars: total,
    maxRetrievedChunks: maxChunks,
    maxRetrievedChars: maxChars
  });

  return sections.join('\n\n---\n\n');
}

export async function buildSourceContext(topic: string, settingsSummary: string, sources: SourceInputs, embeddingConfig: EmbeddingConfig | null): Promise<string> {
  const docs: SourceDocument[] = [];
  const topicTerms = new Set(tokenize(`${topic} ${settingsSummary}`));
  logger.info('source_context.build_started', {
    topic: summarizeText(topic),
    hasSourceText: Boolean(sources.sourceText?.trim()),
    hasGithubRepoUrl: Boolean(sources.githubRepoUrl?.trim()),
    documentCount: sources.documents?.length ?? 0
  });

  if (sources.sourceText?.trim()) {
    docs.push({
      id: 'text:manual',
      label: 'Manual source text',
      text: trimForBudget(sources.sourceText.trim(), MAX_SOURCE_TEXT_CHARS)
    });
    logger.info('source_context.manual_text_added', {
      sourceText: summarizeText(sources.sourceText)
    });
  }

  if (sources.documents?.length) {
    for (const file of sources.documents) {
      if (!file?.buffer?.length) continue;
      const text = await extractTextFromBuffer(file.originalname, file.mimetype, file.buffer);
      const normalized = normalizeWhitespace(text);
      if (!normalized) continue;
      docs.push({
        id: `upload:${file.originalname}`,
        label: `upload:${file.originalname}`,
        text: trimForBudget(normalized, MAX_SOURCE_TEXT_CHARS)
      });
      logger.info('source_context.document_added', {
        name: file.originalname,
        mimeType: file.mimetype,
        bytes: file.size,
        extractedChars: normalized.length
      });
    }
  }

  if (sources.githubRepoUrl?.trim()) {
    const repoDocs = await fetchGitHubRepoDocuments(sources.githubRepoUrl.trim(), topicTerms);
    docs.push(...repoDocs);
  }

  if (!docs.length) {
    logger.info('source_context.empty');
    return '';
  }

  const context = await buildRetrievedContext(topic, settingsSummary, docs, config, embeddingConfig);
  logger.info('source_context.build_completed', {
    documents: docs.length,
    contextChars: context.length
  });
  return trimForBudget(context, embeddingConfig?.maxRetrievedChars ?? DEFAULT_MAX_RETRIEVED_CHARS);
}
