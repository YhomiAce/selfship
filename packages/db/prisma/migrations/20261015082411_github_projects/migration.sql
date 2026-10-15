-- CreateEnum
CREATE TYPE "adapter" AS ENUM ('dockerfile', 'nextjs', 'spa', 'node', 'static');

-- CreateTable
CREATE TABLE "github_installations" (
    "id" UUID NOT NULL,
    "github_installation_id" BIGINT NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "account_avatar_url" TEXT,
    "repository_selection" TEXT NOT NULL DEFAULT 'selected',
    "suspended_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_installation_members" (
    "id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_installation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "github_installation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "repo_id" BIGINT NOT NULL,
    "repo_full_name" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "root_directory" TEXT NOT NULL DEFAULT '',
    "adapter" "adapter" NOT NULL,
    "install_command" TEXT,
    "build_command" TEXT,
    "start_command" TEXT,
    "output_directory" TEXT,
    "port" INTEGER NOT NULL,
    "node_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_github_installation_id_key" ON "github_installations"("github_installation_id");

-- CreateIndex
CREATE INDEX "github_installation_members_user_id_idx" ON "github_installation_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "github_installation_members_installation_id_user_id_key" ON "github_installation_members"("installation_id", "user_id");

-- CreateIndex
CREATE INDEX "projects_github_installation_id_idx" ON "projects"("github_installation_id");

-- CreateIndex
CREATE INDEX "projects_repo_id_idx" ON "projects"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_user_id_name_key" ON "projects"("user_id", "name");

-- AddForeignKey
ALTER TABLE "github_installation_members" ADD CONSTRAINT "github_installation_members_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_installation_members" ADD CONSTRAINT "github_installation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_installation_id_fkey" FOREIGN KEY ("github_installation_id") REFERENCES "github_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
