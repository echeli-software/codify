import type { ApiUser } from '../auth/auth.types.js';
import type { AccessService } from '../billing/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CodeExecutor } from './executor.types.js';
import { ExercisesService, type ExerciseInput } from './exercises.service.js';
import { validateTestCases } from './exercise-tests.js';

const teacher: ApiUser = {
  userId: 'author',
  clerkId: 'c',
  email: 'e',
  role: 'TEACHER',
  displayName: 't',
};
const other: ApiUser = { ...teacher, userId: 'intruder' };

const EXERCISE = {
  id: 'ex1',
  language: 'javascript',
  solutionCode: 'SECRET SOLUTION',
  hiddenTestsJson: [{ id: 'h', expected: 42 }],
};

function setup(supported = ['javascript']) {
  const prisma = {
    lesson: {
      findFirst: jest.fn(async () => ({
        id: 'l1',
        exerciseId: 'ex1',
        module: { course: { authorId: 'author' } },
      })),
      update: jest.fn(),
    },
    exercise: {
      findUnique: jest.fn(async () => EXERCISE),
      update: jest.fn(async ({ data }: { data: object }) => ({
        ...EXERCISE,
        ...data,
      })),
      create: jest.fn(async ({ data }: { data: object }) => ({
        id: 'new',
        ...data,
      })),
    },
  };
  Object.assign(prisma, {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  });
  const executor: CodeExecutor = {
    mode: 'dev',
    supportedLanguages: supported,
    run: jest.fn(),
  };
  const access = {
    resolveLessonAccess: jest.fn(async () => ({ access: { granted: true } })),
  } as unknown as AccessService;
  return {
    service: new ExercisesService(
      prisma as unknown as PrismaService,
      access,
      executor,
    ),
    prisma,
  };
}

const input = (over: Partial<ExerciseInput> = {}): ExerciseInput => ({
  language: 'javascript',
  entryFunction: 'solution',
  starterCode: '',
  solutionCode: 'function solution(){}',
  visibleTests: [{ id: 'v1', name: 'v', args: [], expected: 1 }],
  hiddenTests: [{ id: 'h1', name: 'h', args: [], expected: 2 }],
  ...over,
});

describe('ExercisesService admin ownership', () => {
  it('lets the course author read the full exercise (solution + hidden tests)', async () => {
    const { service } = setup();
    await expect(service.getAdmin(teacher, 'ex1')).resolves.toMatchObject({
      solutionCode: 'SECRET SOLUTION',
    });
  });

  it('forbids another TEACHER from reading, updating, verifying or attaching', async () => {
    const { service, prisma } = setup();
    await expect(service.getAdmin(other, 'ex1')).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.getAdminByLesson(other, 'l1')).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.update(other, 'ex1', { starterCode: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.verifyReference(other, 'ex1')).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.createForLesson(other, 'l1', input()),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.exercise.update).not.toHaveBeenCalled();
  });
});

describe('ExercisesService language whitelist', () => {
  it('rejects languages the active executor cannot run with a clear 400', async () => {
    const { service } = setup(['javascript']);
    const err = (await service
      .update(teacher, 'ex1', { language: 'python' })
      .catch((e: unknown) => e)) as {
      getStatus(): number;
      getResponse(): unknown;
    };
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toMatchObject({ code: 'LANGUAGE_NOT_SUPPORTED' });
  });

  it('rejects unknown languages even if an executor claims them', async () => {
    const { service } = setup(['javascript', 'ruby']);
    await expect(
      service.update(teacher, 'ex1', { language: 'ruby' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects run() for exercises in unsupported languages', async () => {
    const { service, prisma } = setup(['javascript']);
    prisma.exercise.findUnique.mockResolvedValueOnce({
      ...EXERCISE,
      language: 'python',
      lesson: { id: 'l1' },
    } as never);
    await expect(service.run('u1', 'ex1', 'code')).rejects.toMatchObject({
      response: { code: 'LANGUAGE_NOT_SUPPORTED' },
    });
  });

  it('rejects duplicate / malformed test ids', async () => {
    const { service } = setup();
    await expect(
      service.update(teacher, 'ex1', {
        visibleTests: [{ id: 'a', name: 'a', args: [], expected: 1 }],
        hiddenTests: [{ id: 'a', name: 'b', args: [], expected: 2 }],
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_TESTS' },
    });
  });
});

describe('validateTestCases', () => {
  it('flags missing args/expected and bad ids', () => {
    const errors = validateTestCases(
      [
        { id: 'ok', args: [], expected: 1 },
        { id: 'no spaces!', args: 'x' },
      ],
      [],
    );
    expect(errors.join('\n')).toMatch(/id must be/);
    expect(errors.join('\n')).toMatch(/args must be an array/);
    expect(errors.join('\n')).toMatch(/expected is required/);
  });
});
