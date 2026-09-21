import { Global, Module } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { AuditService } from '../audit/audit.service';
import { DATABASE_SOURCE } from './database.tokens';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_SOURCE,
      useFactory: async (): Promise<DataSource> => {
        if (!AppDataSource.isInitialized) await AppDataSource.initialize();
        return AppDataSource;
      },
    },
    AuditService,
  ],
  exports: [DATABASE_SOURCE, AuditService],
})
export class DatabaseModule {}
