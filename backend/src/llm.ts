import { generateObject, generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger, summarizeText } from './logger.js';
import type { QuizQuestion, QuizSettings } from './types.js';
import type { SourceInputs } from './context.js';
import { buildSourceContext } from './context.js';
import { getEffectiveSettings } from './settings.js';
import type { EffectiveSettings } from './settings.js';
import { buildDifficultyPromptGuidance, getDifficultyBand } from './difficulty.js';

const outputSchema = z.object({
  title: z.string().min(3),
  questions: z.array(z.object({
    question: z.string().min(5),
    responseType: z.enum(['single_choice', 'multi_select']),
    choices: z.array(z.string().min(1)).min(2),
    correctAnswers: z.array(z.number().int().nonnegative()).min(1),
    explanation: z.string().optional()
  })).min(1)
});

const groupProposalSchema = z.object({
  groupTitle: z.string().min(3),
  items: z.array(z.object({
    title: z.string().min(3),
    focus: z.string().min(10)
  })).min(1)
});

type LlmProgressStep = 'Preparing sources' | 'Retrieving context' | 'Calling model' | 'Validating output';

type LlmProgressCallbacks = {
  onProgress?: (step: LlmProgressStep) => void;
};

export function shuffleArray<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

export function shuffleQuestionChoices(question: QuizQuestion): QuizQuestion {
  const indexedChoices = question.choices.map((choice, index) => ({ choice, index }));
  const shuffledChoices = shuffleArray(indexedChoices);
  const correctSet = new Set(question.correctAnswers);

  return {
    ...question,
    choices: shuffledChoices.map((entry) => entry.choice),
    correctAnswers: shuffledChoices
      .map((entry, index) => (correctSet.has(entry.index) ? index : -1))
      .filter((index) => index >= 0)
  };
}

export function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

async function generateStructuredOutput<T>(
  model: ReturnType<typeof getModel>,
  schema: z.ZodType<T>,
  cfg: EffectiveSettings,
  system: string,
  prompt: string
): Promise<T> {
  try {
    const { object } = await generateObject({
      model,
      schema,
      maxOutputTokens: cfg.LLM_MAX_TOKENS,
      system,
      prompt
    });
    return schema.parse(object);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (!/could not parse the response|No object generated/i.test(message)) {
      throw error;
    }

    const { text } = await generateText({
      model,
      maxOutputTokens: cfg.LLM_MAX_TOKENS,
      system,
      prompt
    });
    const parsed = JSON.parse(extractJsonPayload(text));
    return schema.parse(parsed);
  }
}

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

export function sanitizeQuestions(
  parsed: z.infer<typeof outputSchema>,
  settings: QuizSettings
): QuizQuestion[] {
  const limitedQuestions = parsed.questions.slice(0, settings.numQuestions);
  if (limitedQuestions.length < settings.numQuestions) {
    throw new Error('LLM returned too few questions for requested constraints');
  }

  return limitedQuestions.map((q) => {
    const uniqueCorrectAnswers = Array.from(new Set(q.correctAnswers));
    if (uniqueCorrectAnswers.length !== q.correctAnswers.length) {
      throw new Error('LLM returned duplicate correctAnswers indices');
    }
    if (uniqueCorrectAnswers.some((answer) => answer >= q.choices.length)) {
      throw new Error('LLM returned invalid correctAnswers outside choices range');
    }

    const lowerChoices = q.choices.map((choice) => choice.toLowerCase());
    const trueFalseChoices = lowerChoices.includes('true') && lowerChoices.includes('false');

    if (settings.questionType === 'true_false') {
      if (q.responseType !== 'single_choice' || q.choices.length !== 2 || !trueFalseChoices || uniqueCorrectAnswers.length !== 1) {
        throw new Error('LLM returned invalid true_false question');
      }
    } else if (settings.questionType === 'multiple_choice') {
      if (q.responseType !== 'single_choice' || uniqueCorrectAnswers.length !== 1) {
        throw new Error('LLM returned invalid multiple_choice question');
      }
    } else if (settings.questionType === 'multi_select') {
      if (q.responseType !== 'multi_select' || q.choices.length < 4 || uniqueCorrectAnswers.length < 2 || uniqueCorrectAnswers.length >= q.choices.length) {
        throw new Error('LLM returned invalid multi_select question');
      }
    } else if (q.responseType === 'single_choice' && uniqueCorrectAnswers.length !== 1) {
      throw new Error('LLM returned invalid single_choice question in mixed mode');
    } else if (q.responseType === 'multi_select' && (q.choices.length < 4 || uniqueCorrectAnswers.length < 2 || uniqueCorrectAnswers.length >= q.choices.length)) {
      throw new Error('LLM returned invalid multi_select question in mixed mode');
    }

    return shuffleQuestionChoices({
      id: randomUUID(),
      question: q.question,
      responseType: q.responseType,
      choices: q.choices,
      correctAnswers: uniqueCorrectAnswers,
      explanation: q.explanation
    });
  });
}

export async function generateQuizFromLLM(
  topic: string,
  settings: QuizSettings,
  sources: SourceInputs,
  existingQuestions?: QuizQuestion[],
  regenerationPrompt?: string,
  progress?: LlmProgressCallbacks
): Promise<{ title: string; questions: QuizQuestion[]; contextUsed: boolean; }> {
  progress?.onProgress?.('Preparing sources');
  const cfg = await getEffectiveSettings();

  const settingsSummary = [
    `numQuestions=${settings.numQuestions}`,
    `choicesPerQuestion=${settings.choicesPerQuestion}`,
    `difficulty=${settings.difficulty}/10 (${getDifficultyBand(settings.difficulty).label})`,
    `language=${settings.language}`,
    `questionType=${settings.questionType}`
  ].join('; ');
  const difficultyGuidance = buildDifficultyPromptGuidance(settings.difficulty);

  progress?.onProgress?.('Retrieving context');
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
    difficultyGuidance,
    existingQuestionsText,
    regenerationPromptText,
    'Output schema:',
    '{"title": string, "questions": [{"question": string, "responseType": "single_choice" | "multi_select", "choices": string[], "correctAnswers": number[], "explanation"?: string}]}',
    'For single_choice questions, correctAnswers must contain exactly one index.',
    'For multi_select questions, correctAnswers must contain at least two indices and not cover every choice.',
    'For true_false mode, responseType must be "single_choice" and choices must be exactly ["True", "False"] or ["False", "True"].',
    settings.questionType === 'multi_select'
      ? 'Every question must use responseType "multi_select", have at least 4 choices, and contain plausible distractors.'
      : null,
    settings.questionType === 'mixed'
      ? 'Return a real mix of question styles. If choicesPerQuestion is at least 4, include at least one multi_select question when possible.'
      : null,
    retrievedContext
      ? `Source material (retrieved excerpts):\n${retrievedContext}`
      : 'No source material provided. Use your general knowledge for the requested topic.'
  ].filter(Boolean).join('\n\n');

  let generated: z.infer<typeof outputSchema>;
  try {
    const started = Date.now();
    progress?.onProgress?.('Calling model');
    generated = await generateStructuredOutput(model, outputSchema, cfg, system, prompt);
    progress?.onProgress?.('Validating output');
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

export async function proposeGroupQuizFromLLM(
  topic: string,
  settings: QuizSettings,
  sources: SourceInputs,
  minQuizCount: number,
  maxQuizCount: number,
  progress?: LlmProgressCallbacks
): Promise<{ groupTitle: string; items: Array<{ title: string; focus: string; }>; contextUsed: boolean; }> {
  progress?.onProgress?.('Preparing sources');
  const cfg = await getEffectiveSettings();
  const settingsSummary = [
    `numQuestions=${settings.numQuestions}`,
    `choicesPerQuestion=${settings.choicesPerQuestion}`,
    `difficulty=${settings.difficulty}/10 (${getDifficultyBand(settings.difficulty).label})`,
    `language=${settings.language}`,
    `questionType=${settings.questionType}`
  ].join('; ');
  const difficultyGuidance = buildDifficultyPromptGuidance(settings.difficulty);

  progress?.onProgress?.('Retrieving context');
  const retrievedContext = await buildSourceContext(topic, settingsSummary, sources, cfg);
  const model = getModel(cfg);

  const system = [
    'You are a curriculum and assessment designer.',
    'Return only structured JSON that conforms to the requested schema.',
    'Propose independent, meaningful quiz candidates for a quiz group.',
    'Merge weak or tiny subtopics into stronger quizzes instead of producing thin standalone items.',
    'Do not generate questions yet.',
    'Each item focus must clearly explain the intended scope of that quiz.',
    'Questions must remain answerable from the topic and provided source material when available.',
    'Do not invent unsupported facts when source material is provided.'
  ].join(' ');

  const prompt = [
    `Topic: ${topic}`,
    `Shared quiz constraints: ${settingsSummary}`,
    difficultyGuidance,
    `Return between ${minQuizCount} and ${maxQuizCount} quiz items.`,
    'Prefer a smaller number when the material supports only a few substantial quizzes.',
    'Output schema:',
    '{"groupTitle": string, "items": [{"title": string, "focus": string}]}',
    'Source material must influence grouping decisions when available.',
    retrievedContext
      ? `Source material (retrieved excerpts):\n${retrievedContext}`
      : 'No source material provided. Use your general knowledge for the requested topic.'
  ].join('\n\n');

  try {
    const started = Date.now();
    progress?.onProgress?.('Calling model');
    const parsed = await generateStructuredOutput(model, groupProposalSchema, cfg, system, prompt);
    progress?.onProgress?.('Validating output');
    logger.info('llm.group_proposal.completed', {
      groupTitle: parsed.groupTitle,
      items: parsed.items.length,
      durationMs: Date.now() - started
    });
    return {
      groupTitle: parsed.groupTitle,
      items: parsed.items.slice(0, maxQuizCount),
      contextUsed: Boolean(retrievedContext)
    };
  } catch (error) {
    logger.error('llm.group_proposal.failed', error, {
      providerStyle: cfg.LLM_API_STYLE,
      model: cfg.LLM_MODEL
    });
    throw new Error(`LLM group proposal failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
