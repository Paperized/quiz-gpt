import type { AttemptAnswer, QuizQuestion } from './types.js';

export type NormalizedAttemptAnswer = {
  questionId: string;
  selectedAnswers: number[];
};

export function normalizeAttemptAnswers(
  questions: QuizQuestion[],
  answers: AttemptAnswer[]
): NormalizedAttemptAnswer[] {
  if (answers.length !== questions.length) {
    throw new Error('answers length must match quiz question count');
  }

  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const seen = new Set<string>();

  for (const answer of answers) {
    const question = questionMap.get(answer.questionId);
    if (!question) {
      throw new Error('answers include an unknown questionId');
    }
    if (seen.has(answer.questionId)) {
      throw new Error('answers include a duplicate questionId');
    }
    seen.add(answer.questionId);

    const unique = new Set<number>();
    for (const selected of answer.selectedAnswers) {
      if (!Number.isInteger(selected) || selected < 0 || selected >= question.choices.length) {
        throw new Error('answers include an invalid choice index');
      }
      if (unique.has(selected)) {
        throw new Error('answers include a duplicate choice index');
      }
      unique.add(selected);
    }

    if (question.responseType === 'single_choice' && answer.selectedAnswers.length > 1) {
      throw new Error('single choice questions allow at most one selected answer');
    }
  }

  if (seen.size !== questions.length) {
    throw new Error('answers are missing one or more questions');
  }

  return questions.map((question) => {
    const answer = answers.find((entry) => entry.questionId === question.id);
    return {
      questionId: question.id,
      selectedAnswers: answer?.selectedAnswers ?? []
    };
  });
}

export function scoreQuestion(question: QuizQuestion, selectedAnswers: number[], alpha: number): number {
  if (question.responseType === 'single_choice') {
    return selectedAnswers.length === 1 && question.correctAnswers.includes(selectedAnswers[0]) ? 1 : 0;
  }

  const correctSet = new Set(question.correctAnswers);
  const numCorrect = question.correctAnswers.length;
  const numWrong = question.choices.length - numCorrect;

  if (numCorrect === 0 || numWrong <= 0) {
    throw new Error('multi_select questions require both correct and incorrect choices');
  }

  let correctSelected = 0;
  let wrongSelected = 0;
  for (const selected of selectedAnswers) {
    if (correctSet.has(selected)) correctSelected += 1;
    else wrongSelected += 1;
  }

  return (correctSelected / numCorrect) - (alpha * (wrongSelected / numWrong));
}

export function scoreAttempt(
  questions: QuizQuestion[],
  answers: NormalizedAttemptAnswer[],
  alpha: number
): { score: number; questionScores: number[] } {
  const questionScores = questions.map((question, index) =>
    scoreQuestion(question, answers[index]?.selectedAnswers ?? [], alpha)
  );

  return {
    score: questionScores.reduce((sum, value) => sum + value, 0),
    questionScores
  };
}
