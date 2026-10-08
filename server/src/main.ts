import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter());
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiExceptionFilter());
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.listen(Number(process.env.PORT ?? '3000'));
}

void bootstrap();
