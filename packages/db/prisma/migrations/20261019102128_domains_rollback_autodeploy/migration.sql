-- CreateEnum
CREATE TYPE "DomainKind" AS ENUM ('platform', 'custom');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('pending_dns', 'issuing', 'active', 'error');

-- AlterEnum
ALTER TYPE "DeploymentTrigger" ADD VALUE 'config';

-- AlterTable
ALTER TABLE "deployments" ADD COLUMN     "hint_advice" TEXT,
ADD COLUMN     "hint_title" TEXT,
ADD COLUMN     "source_deployment_id" UUID;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "auto_deploy" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "domains" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "kind" "DomainKind" NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'pending_dns',
    "status_message" TEXT,
    "redirect_to_id" UUID,
    "dns_record_id" TEXT,
    "dns_target" TEXT,
    "verified_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "domains_hostname_key" ON "domains"("hostname");

-- CreateIndex
CREATE INDEX "domains_project_id_idx" ON "domains"("project_id");

-- CreateIndex
CREATE INDEX "domains_status_idx" ON "domains"("status");

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_source_deployment_id_fkey" FOREIGN KEY ("source_deployment_id") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domains" ADD CONSTRAINT "domains_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domains" ADD CONSTRAINT "domains_redirect_to_id_fkey" FOREIGN KEY ("redirect_to_id") REFERENCES "domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
