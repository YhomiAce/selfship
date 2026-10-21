-- CreateEnum
CREATE TYPE "DiagnosisStatus" AS ENUM ('pending', 'ready', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "deployments" ADD COLUMN     "auto_retry" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "build_doctor" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sandbox_expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "is_platform_sandbox" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "build_diagnoses" (
    "id" UUID NOT NULL,
    "deployment_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "DiagnosisStatus" NOT NULL DEFAULT 'pending',
    "fingerprint" TEXT,
    "result" JSONB,
    "error" TEXT,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "auto_remediation" TEXT,
    "feedback" INTEGER,
    "feedback_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "build_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "build_diagnoses_deployment_id_key" ON "build_diagnoses"("deployment_id");

-- CreateIndex
CREATE INDEX "build_diagnoses_user_id_created_at_idx" ON "build_diagnoses"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "build_diagnoses_project_id_fingerprint_idx" ON "build_diagnoses"("project_id", "fingerprint");

-- AddForeignKey
ALTER TABLE "build_diagnoses" ADD CONSTRAINT "build_diagnoses_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_diagnoses" ADD CONSTRAINT "build_diagnoses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
