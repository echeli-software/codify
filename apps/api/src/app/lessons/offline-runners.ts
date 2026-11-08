import type { PrismaService } from '../prisma/prisma.service.js';
import { toTests } from '../exercises/exercise-tests.js';
import type { OfflineExerciseStub, OfflineScenario } from './lessons.dto.js';

/**
 * Runner content shipped in the offline bundle (docs/16 §5): the scenario
 * graph (played locally, `scenario_complete` queued) and the exercise stub
 * — starter code, visible tests and language only. Never the reference
 * solution, the custom harness or hidden tests.
 */
export async function offlineRunners(
  prisma: PrismaService,
  lesson: { exerciseId: string | null; scenarioId: string | null },
): Promise<{ scenario?: OfflineScenario; exercise?: OfflineExerciseStub }> {
  const [scenario, exercise] = await Promise.all([
    lesson.scenarioId
      ? prisma.scenario.findUnique({
          where: { id: lesson.scenarioId },
          select: { id: true, graphJson: true, updatedAt: true },
        })
      : null,
    lesson.exerciseId
      ? prisma.exercise.findUnique({
          where: { id: lesson.exerciseId },
          select: {
            id: true,
            language: true,
            entryFunction: true,
            starterCode: true,
            visibleTestsJson: true,
          },
        })
      : null,
  ]);
  const out: { scenario?: OfflineScenario; exercise?: OfflineExerciseStub } =
    {};
  if (scenario) {
    out.scenario = {
      id: scenario.id,
      graph: scenario.graphJson,
      updatedAt: scenario.updatedAt.toISOString(),
    };
  }
  if (exercise) {
    out.exercise = {
      id: exercise.id,
      language: exercise.language,
      entryFunction: exercise.entryFunction,
      starterCode: exercise.starterCode,
      visibleTests: toTests(exercise.visibleTestsJson).map(
        ({ id, name, args, expected }) => ({ id, name, args, expected }),
      ),
    };
  }
  return out;
}
