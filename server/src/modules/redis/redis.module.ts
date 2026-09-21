import { Global, Module } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { requiredEnv } from '../../config/environment';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async (): Promise<RedisClientType> => {
        const password = requiredEnv('REDIS_PASSWORD');
        const client = createClient({
          socket: {
            host: process.env.REDIS_HOST ?? '127.0.0.1',
            port: Number(process.env.REDIS_PORT ?? '6379'),
          },
          password,
        });
        client.on('error', () => undefined);
        await client.connect();
        return client as RedisClientType;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
