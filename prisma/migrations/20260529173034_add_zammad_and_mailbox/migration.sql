-- CreateTable
CREATE TABLE "zammad_users" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "zammad_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zammad_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mailbox_access" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "zammad_group_id" INTEGER NOT NULL,
    "mailbox_name" TEXT,
    "can_reply" BOOLEAN NOT NULL DEFAULT true,
    "can_update_status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_mailbox_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "zammad_group_id" INTEGER NOT NULL,
    "zammad_channel_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zammad_users_user_id_key" ON "zammad_users"("user_id");

-- CreateIndex
CREATE INDEX "user_mailbox_access_zammad_group_id_idx" ON "user_mailbox_access"("zammad_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_mailbox_access_user_id_zammad_group_id_key" ON "user_mailbox_access"("user_id", "zammad_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_zammad_group_id_key" ON "mailboxes"("zammad_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_zammad_channel_id_key" ON "mailboxes"("zammad_channel_id");

-- AddForeignKey
ALTER TABLE "zammad_users" ADD CONSTRAINT "zammad_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mailbox_access" ADD CONSTRAINT "user_mailbox_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
