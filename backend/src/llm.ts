import { generateObject, generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger, summarizeText } from './logger.js';
import type { QuizQuestion, QuizSettings, FreeTextEvaluation, LLMConfig, EmbeddingConfig } from './types.js';
import { QUESTION_TYPES } from './types.js';
import type { QuestionType, ResponseType } from './types.js';
import type { SourceInputs } from './context.js';
import { buildSourceContext } from './context.js';
import { ANTHROPIC_API_VERSION } from './config.js';
import { buildDifficultyPromptGuidance, getDifficultyBand } from './difficulty.js';
import { secureFetch } from './ip-check.js';

const outputSchema = z.object({
  title: z.string().min(3),
  questions: z.array(z.object({
    question: z.string().min(5),
    responseType: z.enum(['single_choice', 'multi_select', 'free_text']),
    choices: z.array(z.string().min(1)),
    correctAnswers: z.array(z.number().int().nonnegative()),
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
  if (question.responseType === 'free_text') return question;

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
  cfg: LLMConfig,
  system: string,
  prompt: string
): Promise<T> {
  try {
    const { object } = await generateObject({
      model,
      schema,
      maxOutputTokens: cfg.maxTokens,
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
      maxOutputTokens: cfg.maxTokens,
      system,
      prompt
    });
    const parsed = JSON.parse(extractJsonPayload(text));
    return schema.parse(parsed);
  }
}

function getModel(cfg: LLMConfig) {
  if (!cfg.apiKey) {
    throw new Error('LLM API key is empty. Set it to generate quizzes.');
  }

  if (cfg.provider === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
      fetch: secureFetch,
      headers: {
        'anthropic-version': ANTHROPIC_API_VERSION
      }
    });
    return anthropic(cfg.modelId);
  }

  if (cfg.provider === 'openai_compatible') {
    const provider = createOpenAICompatible({
      name: 'compatible',
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
      fetch: secureFetch
    });
    return provider(cfg.modelId);
  }

  const openai = createOpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl,
    fetch: secureFetch
  });
  return openai(cfg.modelId);
}

export function sanitizeQuestions(
  parsed: z.infer<typeof outputSchema>,
  settings: QuizSettings
): QuizQuestion[] {
  const limitedQuestions = parsed.questions.slice(0, settings.numQuestions);
  if (limitedQuestions.length < settings.numQuestions) {
    throw new Error('LLM returned too few questions for requested constraints');
  }

  const allowedTypes = new Set(settings.questionType);

  return limitedQuestions.map((q) => {
    const mappedTypes = responseTypeToQuestionTypes(q.responseType);
    if (!mappedTypes.some((t) => allowedTypes.has(t))) {
      throw new Error(`LLM returned responseType "${q.responseType}" not compatible with requested types [${settings.questionType.join(', ')}]`);
    }

    if (q.responseType === 'free_text') {
      return {
        id: randomUUID(),
        question: q.question,
        responseType: 'free_text' as const,
        choices: [],
        correctAnswers: [],
        explanation: q.explanation
      };
    }

    const uniqueCorrectAnswers = Array.from(new Set(q.correctAnswers));
    if (uniqueCorrectAnswers.length !== q.correctAnswers.length) {
      throw new Error('LLM returned duplicate correctAnswers indices');
    }
    if (uniqueCorrectAnswers.some((answer) => answer >= q.choices.length)) {
      throw new Error('LLM returned invalid correctAnswers outside choices range');
    }

    const lowerChoices = q.choices.map((choice) => choice.toLowerCase());
    const trueFalseChoices = lowerChoices.includes('true') && lowerChoices.includes('false');

    if (q.responseType === 'single_choice') {
      if (q.choices.length < 2 || uniqueCorrectAnswers.length !== 1) {
        throw new Error('LLM returned invalid single_choice question');
      }
    } else if (q.responseType === 'multi_select') {
      if (q.choices.length < 4 || uniqueCorrectAnswers.length < 2 || uniqueCorrectAnswers.length >= q.choices.length) {
        throw new Error('LLM returned invalid multi_select question');
      }
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

const QUESTION_TYPE_INSTRUCTIONS: Record<QuestionType, string> = {
  multiple_choice: 'responseType "single_choice", at least 2 plausible distractors, exactly 1 correct answer',
  true_false: 'responseType "single_choice", exactly 2 choices ["True", "False"], exactly 1 correct answer',
  multi_select: 'responseType "multi_select", at least 4 choices, at least 2 correct answers, not all choices can be correct',
  free_text: 'responseType "free_text", no choices, no correctAnswers, open-ended question answerable with a paragraph'
};

function buildQuestionTypeInstructions(types: QuestionType[]): string {
  if (types.length === 1) {
    const inst = QUESTION_TYPE_INSTRUCTIONS[types[0]];
    return `Every question must use ${inst}.`;
  }
  const list = types.map((t) => `- ${QUESTION_TYPE_INSTRUCTIONS[t]}`).join('\n');
  return `Include a balanced mix of the following question types:\n${list}`;
}

function responseTypeToQuestionTypes(rt: ResponseType): QuestionType[] {
  if (rt === 'single_choice') return ['multiple_choice', 'true_false'];
  if (rt === 'multi_select') return ['multi_select'];
  return ['free_text'];
}

export async function generateQuizFromLLM(
  llmConfig: LLMConfig,
  embeddingConfig: EmbeddingConfig | null,
  topic: string,
  settings: QuizSettings,
  sources: SourceInputs,
  existingQuestions?: QuizQuestion[],
  regenerationPrompt?: string,
  progress?: LlmProgressCallbacks
): Promise<{ title: string; questions: QuizQuestion[]; contextUsed: boolean; }> {
  progress?.onProgress?.('Preparing sources');

  const settingsSummary = [
    `numQuestions=${settings.numQuestions}`,
    `choicesPerQuestion=${settings.choicesPerQuestion}`,
    `difficulty=${settings.difficulty}/10 (${getDifficultyBand(settings.difficulty).label})`,
    `language=${settings.language}`,
    `questionTypes=[${settings.questionType.join(', ')}]`
  ].join('; ');
  const difficultyGuidance = buildDifficultyPromptGuidance(settings.difficulty);

  progress?.onProgress?.('Retrieving context');
  const retrievedContext = await buildSourceContext(topic, settingsSummary, sources, embeddingConfig);
  const model = getModel(llmConfig);
  logger.info('llm.generate_object.requested', {
    topic: summarizeText(topic),
    settings,
    contextUsed: Boolean(retrievedContext),
    contextChars: retrievedContext.length,
    isRegeneration: Boolean(existingQuestions),
    provider: llmConfig.provider,
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.modelId,
    maxTokens: llmConfig.maxTokens,
    temperature: llmConfig.temperature
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
    '{"title": string, "questions": [{"question": string, "responseType": "single_choice" | "multi_select" | "free_text", "choices": string[], "correctAnswers": number[], "explanation"?: string}]}',
    'For single_choice questions, correctAnswers must contain exactly one index.',
    'For multi_select questions, correctAnswers must contain at least two indices and not cover every choice.',
    'For free_text questions, set choices to [] and correctAnswers to [].',
    buildQuestionTypeInstructions(settings.questionType),
    retrievedContext
      ? `Source material (retrieved excerpts):\n${retrievedContext}`
      : 'No source material provided. Use your general knowledge for the requested topic.'
  ].filter(Boolean).join('\n\n');

  let generated: z.infer<typeof outputSchema>;
  try {
    const started = Date.now();
    progress?.onProgress?.('Calling model');
    generated = await generateStructuredOutput(model, outputSchema, llmConfig, system, prompt);
    progress?.onProgress?.('Validating output');
    logger.info('llm.generate_object.completed', {
      title: generated.title,
      questions: generated.questions.length,
      durationMs: Date.now() - started
    });
  } catch (error) {
    logger.error('llm.generate_object.failed', error, {
      providerStyle: llmConfig.provider,
      model: llmConfig.modelId
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
  llmConfig: LLMConfig,
  embeddingConfig: EmbeddingConfig | null,
  topic: string,
  settings: QuizSettings,
  sources: SourceInputs,
  minQuizCount: number,
  maxQuizCount: number,
  progress?: LlmProgressCallbacks
): Promise<{ groupTitle: string; items: Array<{ title: string; focus: string; }>; contextUsed: boolean; }> {
  progress?.onProgress?.('Preparing sources');
  const settingsSummary = [
    `numQuestions=${settings.numQuestions}`,
    `choicesPerQuestion=${settings.choicesPerQuestion}`,
    `difficulty=${settings.difficulty}/10 (${getDifficultyBand(settings.difficulty).label})`,
    `language=${settings.language}`,
    `questionTypes=[${settings.questionType.join(', ')}]`
  ].join('; ');
  const difficultyGuidance = buildDifficultyPromptGuidance(settings.difficulty);

  progress?.onProgress?.('Retrieving context');
  const retrievedContext = await buildSourceContext(topic, settingsSummary, sources, embeddingConfig);
  const model = getModel(llmConfig);

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
    const parsed = await generateStructuredOutput(model, groupProposalSchema, llmConfig, system, prompt);
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
      providerStyle: llmConfig.provider,
      model: llmConfig.modelId
    });
    throw new Error(`LLM group proposal failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export async function evaluateFreeTextAnswers(
  llmConfig: LLMConfig,
  questions: QuizQuestion[],
  answers: { questionId: string; text: string }[],
  quizContext: { title: string; topic: string }
): Promise<FreeTextEvaluation[]> {
  const model = getModel(llmConfig);

  const questionIds = questions.map((q) => q.id);

  const questionsText = questions.map((q, i) => {
    const answer = answers.find((a) => a.questionId === q.id);
    return `Question ${i + 1} (id: ${q.id}): ${q.question}\nUser's answer: ${answer?.text ?? '(no answer)'}`;
  }).join('\n\n');

  const system = [
    'You are an expert evaluator. Assess free-text answers against the questions and quiz context.',
    'For each answer, provide a score from 0 to 1, a detailed explanation, and the optimal answer.',
    'Score 0 = completely wrong or empty, 1 = perfect. Use partial scores where appropriate.',
    'The explanation must evaluate the answer step by step: what is correct, what is missing or wrong, and why.',
    'The optimalAnswer is what an ideal complete answer would look like.',
    'Return ONLY valid JSON. The response must be a single JSON object with an "evaluations" array.',
    'Each evaluation object must have: "questionId" (the exact same id from the question), "score" (number 0-1), "explanation" (string), "optimalAnswer" (string).',
    'Example: {"evaluations": [{"questionId": "abc-123", "score": 0.8, "explanation": "Good answer but...", "optimalAnswer": "The ideal answer is..."}]}'
  ].join(' ');

  const prompt = [
    `Quiz: ${quizContext.title}`,
    `Topic: ${quizContext.topic}`,
    '',
    'Evaluate the following free-text answers and return the exact JSON structure:',
    '{"evaluations": [{"questionId": "...", "score": 0.5, "explanation": "...", "optimalAnswer": "..."}]}',
    '',
    questionsText
  ].join('\n');

  logger.info('llm.free_text_evaluation.requested', {
    questionCount: questions.length,
    providerStyle: llmConfig.provider,
    model: llmConfig.modelId
  });

  try {
    const started = Date.now();
    const { text } = await generateText({
      model,
      maxOutputTokens: llmConfig.maxTokens,
      system,
      prompt
    });

    const raw = JSON.parse(extractJsonPayload(text));

    let rawEvaluations: unknown[];

    if (Array.isArray(raw)) {
      rawEvaluations = raw;
    } else if (raw && typeof raw === 'object' && 'evaluations' in raw && Array.isArray((raw as Record<string, unknown>).evaluations)) {
      rawEvaluations = (raw as Record<string, unknown>).evaluations as unknown[];
    } else {
      throw new Error('LLM did not return evaluations as an array');
    }

    const evaluations: FreeTextEvaluation[] = rawEvaluations.map((e: unknown, i: number) => {
      const item = e as Record<string, unknown>;
      return {
        questionId: typeof item.questionId === 'string' ? item.questionId : questionIds[i],
        score: typeof item.score === 'number' ? Math.max(0, Math.min(1, item.score)) : 0,
        explanation: typeof item.explanation === 'string' ? item.explanation : 'No explanation provided',
        optimalAnswer: typeof item.optimalAnswer === 'string' ? item.optimalAnswer : 'No optimal answer provided'
      };
    });

    logger.info('llm.free_text_evaluation.completed', {
      evaluations: evaluations.length,
      durationMs: Date.now() - started
    });
    return evaluations;
  } catch (error) {
    logger.error('llm.free_text_evaluation.failed', error, {
      providerStyle: llmConfig.provider,
      model: llmConfig.modelId
    });
    throw new Error(`Free-text evaluation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
