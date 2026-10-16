-- CreateEnum
CREATE TYPE "server_status" AS ENUM ('awaiting_key', 'checking', 'checked', 'needs_attention', 'setting_up', 'setup_failed', 'ready', 'unreachable');

-- CreateEnum
CREATE TYPE "server_key_source" AS ENUM ('generated', 'pasted', 'password');

-- CreateEnum
CREATE TYPE "capability_tier" AS ENUM ('static_only', 'standard', 'recommended');

-- CreateEnum
CREATE TYPE "server_job_type" AS ENUM ('check', 'setup');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "servers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "ssh_user" TEXT NOT NULL,
    "key_source" "server_key_source" NOT NULL,
    "encrypted_private_key" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "key_comment" TEXT NOT NULL,
    "host_key_fingerprint" TEXT,
    "status" "server_status" NOT NULL DEFAULT 'awaiting_key',
    "status_message" TEXT,
    "os" TEXT,
    "os_version" TEXT,
    "arch" TEXT,
    "cpus" INTEGER,
    "ram_mb" INTEGER,
    "swap_mb" INTEGER,
    "disk_free_gb" INTEGER,
    "docker_version" TEXT,
    "tier" "capability_tier",
    "problems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_checked_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_jobs" (
    "id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "type" "server_job_type" NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'queued',
    "log" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "server_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "servers_user_id_idx" ON "servers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "servers_user_id_name_key" ON "servers"("user_id", "name");

-- CreateIndex
CREATE INDEX "server_jobs_server_id_created_at_idx" ON "server_jobs"("server_id", "created_at");

-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "servers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_jobs" ADD CONSTRAINT "server_jobs_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
