-- CreateEnum
CREATE TYPE "EnvScope" AS ENUM ('runtime', 'build', 'both');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('queued', 'cloning', 'building', 'starting', 'health_check', 'switching', 'live', 'failed', 'cancelled', 'replaced');

-- CreateEnum
CREATE TYPE "DeploymentTrigger" AS ENUM ('manual', 'push', 'rollback');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "health_check_path" TEXT NOT NULL DEFAULT '/',
ADD COLUMN     "server_id" UUID;

-- CreateTable
CREATE TABLE "env_vars" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "scope" "EnvScope" NOT NULL DEFAULT 'runtime',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "env_vars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "server_id" UUID,
    "triggered_by_id" UUID,
    "trigger" "DeploymentTrigger" NOT NULL DEFAULT 'manual',
    "status" "DeploymentStatus" NOT NULL DEFAULT 'queued',
    "branch" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "commit_message" TEXT NOT NULL,
    "commit_author" TEXT,
    "stages" JSONB NOT NULL DEFAULT '{}',
    "failed_stage" "DeploymentStatus",
    "error_summary" TEXT,
    "image_tag" TEXT,
    "container_name" TEXT,
    "url" TEXT,
    "cancel_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_log_chunks" (
    "id" UUID NOT NULL,
    "deployment_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_log_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "env_vars_project_id_key_key" ON "env_vars"("project_id", "key");

-- CreateIndex
CREATE INDEX "deployments_project_id_created_at_idx" ON "deployments"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "deployments_server_id_status_idx" ON "deployments"("server_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_log_chunks_deployment_id_seq_key" ON "deployment_log_chunks"("deployment_id", "seq");

-- CreateIndex
CREATE INDEX "projects_server_id_idx" ON "projects"("server_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "env_vars" ADD CONSTRAINT "env_vars_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_log_chunks" ADD CONSTRAINT "deployment_log_chunks_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
