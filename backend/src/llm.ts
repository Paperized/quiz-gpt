import { z } from 'zod';
import { config } from './config.js';
import type { QuizQuestion, QuizSettings } from './types.js';

const outputSchema = z.object({
  title: z.string().min(3),
  questions: z.array(z.object({
    question: z.string().min(5),
    choices: z.array(z.string().min(1)).min(2),
    correctIndex: z.number().int().nonnegative(),
    explanation: z.string().optional()
  })).min(1)
});

function extractJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (block?.[1]) {
      return JSON.parse(block[1]);
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error('No valid JSON found in LLM output');
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function withPath(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function parseOpenAIError(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const err = (payload as { error?: { message?: string; }; }).error;
    if (err?.message) {
      return `LLM request failed (${status}): ${err.message}`;
    }
  }
  return `LLM request failed with status ${status}`;
}

async function requestOpenAICompatible(system: string, user: string): Promise<string> {
  const response = await fetch(withPath(config.LLM_BASE_URL, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: config.LLM_MODEL,
      temperature: config.LLM_TEMPERATURE,
      max_tokens: config.LLM_MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(parseOpenAIError(response.status, await response.json().catch(() => ({}))));
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string; }; }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM response did not include content');
  }
  return content;
}

async function requestAnthropicCompatible(system: string, user: string): Promise<string> {
  const base = normalizeBaseUrl(config.LLM_BASE_URL);
  const path = base.endsWith('/v1') ? '/messages' : '/v1/messages';

  const response = await fetch(withPath(base, path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.LLM_API_KEY,
      'anthropic-version': config.ANTHROPIC_VERSION,
      Authorization: `Bearer ${config.LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: config.LLM_MODEL,
      max_tokens: config.LLM_MAX_TOKENS,
      temperature: config.LLM_TEMPERATURE,
      system,
      messages: [
        { role: 'user', content: user }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(parseOpenAIError(response.status, await response.json().catch(() => ({}))));
  }

  const payload = await response.json() as {
    content?: Array<{ type?: string; text?: string; }>;
  };

  const text = payload.content
    ?.filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('LLM response did not include text content');
  }
  return text;
}

function sanitizeQuestions(
  parsed: z.infer<typeof outputSchema>,
  settings: QuizSettings
): QuizQuestion[] {
  const limitedQuestions = parsed.questions.slice(0, settings.maxQuestions);
  if (limitedQuestions.length < settings.minQuestions) {
    throw new Error('LLM returned too few questions for requested constraints');
  }

  return limitedQuestions.map((q) => {
    if (q.correctIndex >= q.choices.length) {
      throw new Error('LLM returned invalid correctIndex outside choices range');
    }
    if (settings.questionType === 'true_false' && (q.choices.length !== 2 || !q.choices.includes('True') || !q.choices.includes('False'))) {
      throw new Error('LLM returned non true/false choices for true_false mode');
    }
    return {
      question: q.question,
      choices: q.choices,
      correctIndex: q.correctIndex,
      explanation: q.explanation
    };
  });
}

export async function generateQuizFromLLM(topic: string, settings: QuizSettings): Promise<{ title: string; questions: QuizQuestion[]; }> {
  if (!config.LLM_API_KEY) {
    throw new Error('LLM_API_KEY is empty. Set it to generate quizzes.');
  }

  const system = 'You are a quiz generator. Return only valid JSON with no additional prose.';
  const user = `Generate a quiz as JSON with this exact structure: {"title": string, "questions": [{"question": string, "choices": string[], "correctIndex": number, "explanation"?: string}]}. Constraints: topic=${topic}; minQuestions=${settings.minQuestions}; maxQuestions=${settings.maxQuestions}; choicesPerQuestion=${settings.choicesPerQuestion}; difficulty=${settings.difficulty}; language=${settings.language}; questionType=${settings.questionType}. For true/false mode, choices must be exactly ["True", "False"]. correctIndex must always be valid for choices.`;

  const content = config.LLM_API_STYLE === 'anthropic'
    ? await requestAnthropicCompatible(system, user)
    : await requestOpenAICompatible(system, user);

  let parsed: z.infer<typeof outputSchema>;
  try {
    parsed = outputSchema.parse(extractJson(content));
  } catch (error) {
    throw new Error(`LLM returned malformed JSON: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  return {
    title: parsed.title,
    questions: sanitizeQuestions(parsed, settings)
  };
}
