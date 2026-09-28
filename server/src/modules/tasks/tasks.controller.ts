import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(AccessTokenGuard, AdminGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.tasks.create(request.user, body, request.ip ?? 'unknown');
  }
}
