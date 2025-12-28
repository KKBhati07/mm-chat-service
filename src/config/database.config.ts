import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const databaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DB_HOST'),
  port: configService.get<number>('DB_PORT'),
  username: configService.get<string>('DB_USER'),
  password: configService.get<string>('DB_PASSWORD'),
  database: configService.get<string>('DB_NAME'),

  autoLoadEntities: true,
  synchronize: false, // to not sync schema automatically
  logging: ['error'],

  migrations: ['dist/migrations/*.js'], // to compare pending migrations at runtime
  migrationsTableName: 'typeorm_migrations', // table for migration matadata
});
