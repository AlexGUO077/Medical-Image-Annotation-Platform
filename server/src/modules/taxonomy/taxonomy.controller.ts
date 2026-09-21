import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { TaxonomyService } from './taxonomy.service';

@Controller('taxonomy')
@UseGuards(AccessTokenGuard)
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get('tree')
  tree() {
    return this.taxonomy.tree();
  }

  @Get('sign-tags')
  @UseGuards(AdminGuard)
  listSignTags(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('system_code') systemCode: string | undefined,
    @Query('keyword') keyword: string | undefined,
  ) {
    return this.taxonomy.listSignTags(page, pageSize, systemCode, keyword);
  }

  @Post('nodes')
  @UseGuards(AdminGuard)
  createNode(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.taxonomy.createNode(this.actor(request), body, request.ip ?? 'unknown');
  }

  @Put('nodes/:id')
  @UseGuards(AdminGuard)
  updateNode(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.taxonomy.updateNode(this.actor(request), id, body, request.ip ?? 'unknown');
  }

  @Delete('nodes/:id')
  @UseGuards(AdminGuard)
  deleteNode(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.taxonomy.deleteNode(this.actor(request), id, request.ip ?? 'unknown');
  }

  @Post('sign-tags')
  @UseGuards(AdminGuard)
  createSignTag(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.taxonomy.createSignTag(this.actor(request), body, request.ip ?? 'unknown');
  }

  @Put('sign-tags/:id')
  @UseGuards(AdminGuard)
  updateSignTag(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.taxonomy.updateSignTag(this.actor(request), id, body, request.ip ?? 'unknown');
  }

  @Delete('sign-tags/:id')
  @UseGuards(AdminGuard)
  deleteSignTag(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.taxonomy.deleteSignTag(this.actor(request), id, request.ip ?? 'unknown');
  }

  private actor(request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return request.user;
  }
}
