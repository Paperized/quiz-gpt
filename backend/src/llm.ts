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

export async function generateQuizFromLLM(topic: string, settings: QuizSettings): Promise<{ title: string; questions: QuizQuestion[]; }> {
  if (!config.LLM_API_KEY) {
    throw new Error('LLM_API_KEY is empty. Set it to generate quizzes.');
  }

  const system = 'You are a quiz generator. Return only JSON matching the requested schema.';
  const user = `Generate a quiz as JSON with this structure: {"title": string, "questions": [{"question": string, "choices": string[], "correctIndex": number, "explanation"?: string}]}. Constraints: topic=${topic}; minQuestions=${settings.minQuestions}; maxQuestions=${settings.maxQuestions}; choicesPerQuestion=${settings.choicesPerQuestion}; difficulty=${settings.difficulty}; language=${settings.language}; questionType=${settings.questionType}. For true/false, choices must be exactly ["True", "False"]. correctIndex must be valid for choices.`;

  const response = await fetch(`${config.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
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
    throw new Error(`LLM request failed with status ${response.status}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string; }; }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM response did not include content');
  }

  let parsed: z.infer<typeof outputSchema>;
  try {
    parsed = outputSchema.parse(extractJson(content));
  } catch (error) {
    throw new Error(`LLM returned malformed JSON: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  const limitedQuestions = parsed.questions.slice(0, settings.maxQuestions);
  if (limitedQuestions.length < settings.minQuestions) {
    throw new Error('LLM returned too few questions for requested constraints');
  }

  const sanitized = limitedQuestions.map((q) => {
    if (q.correctIndex >= q.choices.length) {
      throw new Error('LLM returned invalid correctIndex outside choices range');
    }
    return {
      question: q.question,
      choices: q.choices,
      correctIndex: q.correctIndex,
      explanation: q.explanation
    };
  });

  return { title: parsed.title, questions: sanitized };
}
