import { ProblemDetailsError } from '@codify/api-client';
import { runnerError } from './runner-errors';

const problem = (status: number, code: string, retryAfter?: number) =>
  new ProblemDetailsError({
    status,
    code,
    data: retryAfter === undefined ? undefined : { retryAfter },
  });

describe('runnerError', () => {
  it('maps a 503 GRADER_UNAVAILABLE to the translated retry message with seconds', () => {
    expect(runnerError(problem(503, 'GRADER_UNAVAILABLE', 30))).toEqual({
      key: 'student.runner.errors.graderUnavailable',
      params: { seconds: 30 },
    });
  });

  it('maps a 503 CODE_QUEUE_BUSY (Judge0 backlog) to the queue-busy message', () => {
    expect(runnerError(problem(503, 'CODE_QUEUE_BUSY', 4.2))).toEqual({
      key: 'student.runner.errors.queueBusy',
      params: { seconds: 5 },
    });
    expect(runnerError(problem(503, 'CODE_QUEUE_BUSY'))).toEqual({
      key: 'student.runner.errors.queueBusy',
      params: { seconds: 0 },
    });
  });
});
