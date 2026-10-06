import { QualityReviewsService } from './quality-reviews';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskMaintenanceService } from './task-maintenance.service';
import { TaskDispatchService } from './task-dispatch.service';

@Module({ imports: [AuthModule], controllers: [TasksController], providers: [QualityReviewsService, TasksService, TaskDispatchService, TaskMaintenanceService] })
export class TasksModule {}
