import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppLogger } from './core/logger/app.logger';
import * as fs from 'fs';

async function bootstrap() {
  const httpsOptions = {
    key: fs.readFileSync('/certs/wildcard.marketmate.local-key.pem'),
    cert: fs.readFileSync('/certs/wildcard.marketmate.local.pem'),
  };

  const app = await NestFactory.create(AppModule, {
    httpsOptions,
  });

  const configService = app.get(ConfigService);
  const logger = app.get(AppLogger);
  logger.setContext('Bootstrap');

  const allowedOrigins = configService
    .get<string>('ALLOWED_APP_ORIGINS')!
    .split(',');

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  const port = configService.get<number>('PORT')!;
  await app.listen(port);
  logger.log(`Chat service listening on port ${port}`);
  logger.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
}
bootstrap();
