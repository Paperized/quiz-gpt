import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { logger, summarizeText } from './logger.js';
import type { QuizQuestion, QuizSettings } from './types.js';
import type { SourceInputs } from './context.js';
import { buildSourceContext } from './context.js';
import { getEffectiveSettings } from './settings.js';
import type { EffectiveSettings } from './settings.js';

const outputSchema = z.object({
  title: z.string().min(3),
  questions: z.array(z.object({
    question: z.string().min(5),
    choices: z.array(z.string().min(1)).min(2),
    correctIndex: z.number().int().nonnegative(),
    explanation: z.string()
  })).min(1)
});

function getModel(cfg: EffectiveSettings) {
  if (!cfg.LLM_API_KEY) {
    throw new Error('LLM_API_KEY is empty. Set it to generate quizzes.');
  }

  if (cfg.LLM_API_STYLE === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: cfg.LLM_API_KEY,
      baseURL: cfg.LLM_BASE_URL,
      headers: {
        'anthropic-version': cfg.ANTHROPIC_VERSION
      }
    });
    return anthropic(cfg.LLM_MODEL);
  }

  if (cfg.LLM_API_STYLE === 'openai_compatible') {
    const provider = createOpenAICompatible({
      name: 'compatible',
      apiKey: cfg.LLM_API_KEY,
      baseURL: cfg.LLM_BASE_URL
    });
    return provider(cfg.LLM_MODEL);
  }

  const openai = createOpenAI({
    apiKey: cfg.LLM_API_KEY,
    baseURL: cfg.LLM_BASE_URL
  });
  return openai(cfg.LLM_MODEL);
}

function sanitizeQuestions(
  parsed: z.infer<typeof outputSchema>,
  settings: QuizSettings
): QuizQuestion[] {
  const limitedQuestions = parsed.questions.slice(0, settings.numQuestions);
  if (limitedQuestions.length < settings.numQuestions) {
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
  sources: SourceInputs,
  existingQuestions?: QuizQuestion[],
  regenerationPrompt?: string
): Promise<{ title: string; questions: QuizQuestion[]; contextUsed: boolean; }> {
  const cfg = await getEffectiveSettings();

  const settingsSummary = [
    `numQuestions=${settings.numQuestions}`,
    `choicesPerQuestion=${settings.choicesPerQuestion}`,
    `difficulty=${settings.difficulty}`,
    `language=${settings.language}`,
    `questionType=${settings.questionType}`
  ].join('; ');

  const retrievedContext = await buildSourceContext(topic, settingsSummary, sources, cfg);
  const model = getModel(cfg);
  logger.info('llm.generate_object.requested', {
    topic: summarizeText(topic),
    settings,
    contextUsed: Boolean(retrievedContext),
    contextChars: retrievedContext.length,
    isRegeneration: Boolean(existingQuestions),
    provider: {
      style: cfg.LLM_API_STYLE,
      baseUrl: cfg.LLM_BASE_URL,
      model: cfg.LLM_MODEL,
      maxTokens: cfg.LLM_MAX_TOKENS,
      temperature: cfg.LLM_TEMPERATURE
    }
  });

  const isRegeneration = existingQuestions && existingQuestions.length > 0;
  
  const system = isRegeneration
    ? [
        'You are a quiz regenerator.',
        'Return only structured JSON that conforms to the requested schema.',
        'Generate variants of the existing questions provided below.',
        'If an additional instruction is provided and relevant to this topic, incorporate it; otherwise ignore it.',
        'Questions must be answerable from the topic and provided source material when available.',
        'Do not invent unsupported facts when the source material is provided.'
      ].join(' ')
    : [
        'You are a quiz generator.',
        'Return only structured JSON that conforms to the requested schema.',
        'Questions must be answerable from the topic and provided source material when available.',
        'Do not invent unsupported facts when the source material is provided.'
      ].join(' ');

  const existingQuestionsText = isRegeneration
    ? `Existing questions to generate variants of:\n${JSON.stringify(existingQuestions, null, 2)}`
    : '';

  const regenerationPromptText = regenerationPrompt && isRegeneration
    ? `Additional instruction: ${regenerationPrompt}`
    : '';

  const prompt = [
    `Topic: ${topic}`,
    `Constraints: ${settingsSummary}`,
    existingQuestionsText,
    regenerationPromptText,
    'Output schema:',
    '{"title": string, "questions": [{"question": string, "choices": string[], "correctIndex": number, "explanation"?: string}]}',
    'For true_false mode, choices must be exactly ["True", "False"].',
    retrievedContext
      ? `Source material (retrieved excerpts):\n${retrievedContext}`
      : 'No source material provided. Use your general knowledge for the requested topic.'
  ].filter(Boolean).join('\n\n');

  let generated: z.infer<typeof outputSchema>;
  try {
    const started = Date.now();
    const { object } = await generateObject({
      model,
      schema: outputSchema,
      maxOutputTokens: cfg.LLM_MAX_TOKENS,
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
      providerStyle: cfg.LLM_API_STYLE,
      model: cfg.LLM_MODEL
    });
    throw new Error(`LLM generation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  return {
    title: generated.title,
    questions: sanitizeQuestions(generated, settings),
    contextUsed: Boolean(retrievedContext)
  };
}
