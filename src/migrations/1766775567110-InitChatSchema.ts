import { MigrationInterface, QueryRunner } from "typeorm";

export class InitChatSchema1766775567110 implements MigrationInterface {
    name = 'InitChatSchema1766775567110'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" RENAME COLUMN "sender_uuid" TO "sender_id"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" RENAME COLUMN "sender_id" TO "sender_uuid"`);
    }

}
