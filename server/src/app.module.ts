import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SearchModule } from './modules/search/search.module';
import { AnnotationsModule } from './modules/annotations/annotations.module';
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
import { ReviewsModule } from './modules/reviews/reviews.module';

@Module({ imports: [DatabaseModule, RedisModule, HealthModule, AuthModule, UsersModule, TaxonomyModule, CasesModule, TasksModule, FramesModule, WorkbenchModule, AnnotationsModule, ReviewsModule, SearchModule, DashboardModule] })
export class AppModule {}
