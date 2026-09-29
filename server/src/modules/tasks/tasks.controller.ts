import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { TasksService } from './tasks.service';
import { TaskDispatchService } from './task-dispatch.service';

@Controller('tasks')
@UseGuards(AccessTokenGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService, private readonly dispatches: TaskDispatchService) {}

  @Post('dispatch')
  dispatch(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.dispatches.dispatch(request.user, body, request.ip ?? 'unknown');
  }

  @Get('pool')
  @Header('Cache-Control', 'no-store, private')
  pool(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.dispatches.queue(request.user, query, false);
  }

  @Get('mine')
  @Header('Cache-Control', 'no-store, private')
  mine(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.dispatches.queue(request.user, query, true);
  }

  @Post('reclaim')
  @UseGuards(AdminGuard)
  async reclaim(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    const result = await this.dispatches.reclaim(request.user, body, request.ip ?? 'unknown');
    return { ...result, ...(result.dispatch_mode === 'auto' ? { auto_dispatch: await this.dispatches.autoAfter(request.user, result.task_id, request.ip ?? 'unknown') } : {}) };
  }

  @UseGuards(AdminGuard)
  @Patch(':id/settings')
  async settings(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    const result = await this.dispatches.settings(request.user, id, body, request.ip ?? 'unknown');
    return { ...result, ...(result.dispatch_mode === 'auto' ? { auto_dispatch: await this.dispatches.autoAfter(request.user, id, request.ip ?? 'unknown') } : {}) };
  }

  @UseGuards(AdminGuard)
  @Patch('assignees/:id/limit')
  personLimit(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.dispatches.personLimit(request.user, id, body, request.ip ?? 'unknown');
  }

  @UseGuards(AdminGuard)
  @Get()
  @Header('Cache-Control', 'no-store, private')
  list(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.tasks.list(request.user, query);
  }

  @UseGuards(AdminGuard)
  @Get('eligible-cases')
  @Header('Cache-Control', 'no-store, private')
  eligibleCases(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.tasks.eligibleCases(request.user, query);
  }

  @UseGuards(AdminGuard)
  @Get(':id/cases')
  @Header('Cache-Control', 'no-store, private')
  cases(@Param('id') id: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.tasks.cases(request.user, id, query);
  }

  @UseGuards(AdminGuard)
  @Post()
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    const result = await this.tasks.create(request.user, body, request.ip ?? 'unknown');
    return { ...result, ...(result.dispatch_mode === 'auto' ? { auto_dispatch: await this.dispatches.autoAfter(request.user, result.id, request.ip ?? 'unknown') } : {}) };
  }
}
