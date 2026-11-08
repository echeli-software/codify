import { Logger } from '@nestjs/common';
import { scenarioEndingKey, type ScenarioGraph } from '@codify/domain';
import type { PrismaService } from '../prisma/prisma.service.js';

const logger = new Logger('ScenarioBranch');

/** How many earlier completed runs are compared when looking for a new ending. */
const PRIOR_RUNS_LIMIT = 200;

/**
 * Which ending a completed play-through reached, and whether the user had
 * reached it before (docs/07 §2 "Scenario complete (per branch)"). Fed to
 * `ProgressService.recordCompletion({ scenario })`: on an already-completed
 * scenario lesson a *new* ending pays SCENARIO_BRANCH (10 XP / 5 coins,
 * capped per scenario per day). Earlier runs are re-walked against the
 * current graph, so an edited graph compares endings by today's identity.
 * Best-effort: a failed lookup means "no branch reward", never a failed
 * completion.
 */
export async function scenarioEndingInfo(
  prisma: Pick<PrismaService, 'scenarioRun'>,
  input: {
    userId: string;
    scenarioId: string;
    graph: ScenarioGraph;
    choiceIds: readonly string[];
    /** The run just recorded (excluded from "before"). */
    runId: string;
  },
): Promise<
  { scenarioId: string; endingKey: string; isNewEnding: boolean } | undefined
> {
  const endingKey = scenarioEndingKey(input.graph, input.choiceIds);
  if (!endingKey) return undefined;
  let prior: { pathJson: unknown }[];
  try {
    prior = await prisma.scenarioRun.findMany({
      where: {
        userId: input.userId,
        scenarioId: input.scenarioId,
        completed: true,
        id: { not: input.runId },
      },
      select: { pathJson: true },
      orderBy: { createdAt: 'desc' },
      take: PRIOR_RUNS_LIMIT,
    });
  } catch (err) {
    logger.warn(`ending lookup failed: ${(err as Error).message}`);
    return undefined;
  }
  const seen = prior.some((r) => {
    const path = Array.isArray(r.pathJson)
      ? (r.pathJson as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : [];
    return scenarioEndingKey(input.graph, path) === endingKey;
  });
  return { scenarioId: input.scenarioId, endingKey, isNewEnding: !seen };
}
