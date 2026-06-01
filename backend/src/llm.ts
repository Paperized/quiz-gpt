import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { config } from './config.js';
import { logger, summarizeText } from './logger.js';
import type { QuizQuestion, QuizSettings } from './types.js';
import type { SourceInputs } from './context.js';
import { buildSourceContext } from './context.js';

const outputSchema = z.object({
  title: z.string().min(3),
  questions: z.array(z.object({
    question: z.string().min(5),
    choices: z.array(z.string().min(1)).min(2),
    correctIndex: z.number().int().nonnegative(),
    explanation: z.string()
  })).min(1)
});

function getModel() {
  if (!config.LLM_API_KEY) {
    throw new Error('LLM_API_KEY is empty. Set it to generate quizzes.');
  }

  if (config.LLM_API_STYLE === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: config.LLM_API_KEY,
      baseURL: config.LLM_BASE_URL,
      headers: {
        'anthropic-version': config.ANTHROPIC_VERSION
      }
    });
    return anthropic(config.LLM_MODEL);
  }

  if (config.LLM_API_STYLE === 'openai_compatible') {
    const provider = createOpenAICompatible({
      name: 'compatible',
      apiKey: config.LLM_API_KEY,
      baseURL: config.LLM_BASE_URL
    });
    return provider(config.LLM_MODEL);
  }

  const openai = createOpenAI({
    apiKey: config.LLM_API_KEY,
    baseURL: config.LLM_BASE_URL
  });
  return openai(config.LLM_MODEL);
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

export async function generateQuizFromLLM(
  topic: string,
  settings: QuizSettings,
  sources: SourceInputs
): Promise<{ title: string; questions: QuizQuestion[]; contextUsed: boolean; }> {
  const settingsSummary = [
    `minQuestions=${settings.minQuestions}`,
    `maxQuestions=${settings.maxQuestions}`,
    `choicesPerQuestion=${settings.choicesPerQuestion}`,
    `difficulty=${settings.difficulty}`,
    `language=${settings.language}`,
    `questionType=${settings.questionType}`
  ].join('; ');

  const retrievedContext = await buildSourceContext(topic, settingsSummary, sources);
  const model = getModel();
  logger.info('llm.generate_object.requested', {
    topic: summarizeText(topic),
    settings,
    contextUsed: Boolean(retrievedContext),
    contextChars: retrievedContext.length,
    provider: {
      style: config.LLM_API_STYLE,
      baseUrl: config.LLM_BASE_URL,
      model: config.LLM_MODEL,
      maxTokens: config.LLM_MAX_TOKENS,
      temperature: config.LLM_TEMPERATURE
    }
  });

  const system = [
    'You are a quiz generator.',
    'Return only structured JSON that conforms to the requested schema.',
    'Questions must be answerable from the topic and provided source material when available.',
    'Do not invent unsupported facts when the source material is provided.'
  ].join(' ');

  const prompt = [
    `Topic: ${topic}`,
    `Constraints: ${settingsSummary}`,
    'Output schema:',
    '{"title": string, "questions": [{"question": string, "choices": string[], "correctIndex": number, "explanation"?: string}]}',
    'For true_false mode, choices must be exactly ["True", "False"].',
    retrievedContext
      ? `Source material (retrieved excerpts):\n${retrievedContext}`
      : 'No source material provided. Use your general knowledge for the requested topic.'
  ].join('\n\n');

  let generated: z.infer<typeof outputSchema>;
  try {
    const started = Date.now();
    const { object } = await generateObject({
      model,
      schema: outputSchema,
      maxOutputTokens: config.LLM_MAX_TOKENS,
      system,
      prompt
    });
    generated = outputSchema.parse(object);
    logger.info('llm.generate_object.completed', {
      title: generated.title,
      questions: generated.questions.length,
      durationMs: Date.now() - started
    });
  } catch (error) {
    logger.error('llm.generate_object.failed', error, {
      providerStyle: config.LLM_API_STYLE,
      model: config.LLM_MODEL
    });
    throw new Error(`LLM generation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  return {
    title: generated.title,
    questions: sanitizeQuestions(generated, settings),
    contextUsed: Boolean(retrievedContext)
  };
}
