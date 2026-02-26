import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as fs from 'fs';

async function bootstrap() {
  const httpsOptions = {
    key: fs.readFileSync('/certs/wildcard.marketmate.local-key.pem'),
    cert: fs.readFileSync('/certs/wildcard.marketmate.local.pem'),
  };

  const app = await NestFactory.create(AppModule, {
    httpsOptions,
  });
  
  // Enable CORS globally for HTTP requests
  const allowedOrigins = process.env.ALLOWED_APP_ORIGINS?.split(',') ?? [
    'https://marketmate.local:4200',
    'https://admin.marketmate.local:4300',
    'http://localhost:4200',
    'http://localhost:4300'
  ];
  
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  
  const port = process.env.PORT ?? 4400;
  await app.listen(port);
  console.log(`Chat service listening on port ${port}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
}
bootstrap();
