import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { DatabaseModule } from './modules/database/database.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './modules/redis/redis.module';
import { TaxonomyModule } from './modules/taxonomy/taxonomy.module';
import { UsersModule } from './modules/users/users.module';
import { CasesModule } from './modules/cases/cases.module';
import { WorkbenchModule } from './modules/workbench/workbench.module';
import { FramesModule } from './modules/frames/frames.module';
import { TasksModule } from './modules/tasks/tasks.module';

@Module({ imports: [DatabaseModule, RedisModule, HealthModule, AuthModule, UsersModule, TaxonomyModule, CasesModule, TasksModule, FramesModule, WorkbenchModule] })
export class AppModule {}
