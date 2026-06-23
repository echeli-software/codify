-- CreateEnum
CREATE TYPE "GradedBy" AS ENUM ('HEURISTIC', 'LLM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CoinSource" ADD VALUE 'AI_PROMPT_PASS';
ALTER TYPE "CoinSource" ADD VALUE 'SCENARIO_COMPLETE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "XpSource" ADD VALUE 'AI_PROMPT_PASS';
ALTER TYPE "XpSource" ADD VALUE 'SCENARIO_COMPLETE';

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "aiPromptId" TEXT,
ADD COLUMN     "scenarioId" TEXT;

-- CreateTable
CREATE TABLE "AiPrompt" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "promptText" TEXT NOT NULL,
    "contextText" TEXT,
    "rubricJson" JSONB NOT NULL,
    "passThreshold" INTEGER NOT NULL DEFAULT 70,
    "maxAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSubmission" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "userId" TEXT NOT NULL,
    "aiPromptId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "scorePct" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "breakdownJson" JSONB NOT NULL,
    "gradedBy" "GradedBy" NOT NULL DEFAULT 'HEURISTIC',
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "graphJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioRun" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "pathJson" JSONB NOT NULL,
    "maxDepth" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSubmission_userId_aiPromptId_idx" ON "AiSubmission"("userId", "aiPromptId");

-- CreateIndex
CREATE INDEX "AiSubmission_aiPromptId_idx" ON "AiSubmission"("aiPromptId");

-- CreateIndex
CREATE INDEX "ScenarioRun_userId_scenarioId_idx" ON "ScenarioRun"("userId", "scenarioId");

-- CreateIndex
CREATE INDEX "ScenarioRun_scenarioId_idx" ON "ScenarioRun"("scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_aiPromptId_key" ON "Lesson"("aiPromptId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_scenarioId_key" ON "Lesson"("scenarioId");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_aiPromptId_fkey" FOREIGN KEY ("aiPromptId") REFERENCES "AiPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSubmission" ADD CONSTRAINT "AiSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSubmission" ADD CONSTRAINT "AiSubmission_aiPromptId_fkey" FOREIGN KEY ("aiPromptId") REFERENCES "AiPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioRun" ADD CONSTRAINT "ScenarioRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioRun" ADD CONSTRAINT "ScenarioRun_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

