import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { TasksService } from './tasks.service';
import { TaskDispatchService } from './task-dispatch.service';

@Controller('tasks')
@UseGuards(AccessTokenGuard, AdminGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService, private readonly dispatches: TaskDispatchService) {}

  @Post('dispatch')
  dispatch(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.dispatches.dispatch(request.user, body, request.ip ?? 'unknown');
  }

  @Patch(':id/settings')
  settings(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.dispatches.settings(request.user, id, body, request.ip ?? 'unknown');
  }

  @Patch('assignees/:id/limit')
  personLimit(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.dispatches.personLimit(request.user, id, body, request.ip ?? 'unknown');
  }

  @Get()
  @Header('Cache-Control', 'no-store, private')
  list(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.tasks.list(request.user, query);
  }

  @Get('eligible-cases')
  @Header('Cache-Control', 'no-store, private')
  eligibleCases(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.tasks.eligibleCases(request.user, query);
  }

  @Get(':id/cases')
  @Header('Cache-Control', 'no-store, private')
  cases(@Param('id') id: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.tasks.cases(request.user, id, query);
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.tasks.create(request.user, body, request.ip ?? 'unknown');
  }
}
