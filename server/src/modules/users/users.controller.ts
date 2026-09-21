import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AccessTokenGuard, AdminGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query('page') page: string | undefined, @Query('pageSize') pageSize: string | undefined) {
    return this.users.list(page, pageSize);
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.users.create(request.user, body, request.ip ?? 'unknown');
  }

  @Patch()
  update(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.users.update(request.user, body, request.ip ?? 'unknown');
  }
}
