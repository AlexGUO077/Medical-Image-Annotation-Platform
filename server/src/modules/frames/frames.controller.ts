import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { FramesService } from './frames.service';

@Controller('frames')
@UseGuards(AccessTokenGuard)
export class FramesController {
  constructor(private readonly frames: FramesService) {}
  @Post('ticket')
  @Header('Cache-Control', 'no-store, private')
  @Header('Referrer-Policy', 'no-referrer')
  ticket(@Req() request: AuthenticatedRequest, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new BadRequestException('帧接口不接受查询参数');
    if (!request.user) throw new Error('Authenticated user missing');
    return this.frames.issue(request.user, this.bearer(request), body, request.ip ?? 'unknown');
  }
  @Get(':token')
  async read(@Req() request: AuthenticatedRequest, @Param('token') token: string, @Query() query: Record<string, unknown>, @Res() response: Response) {
    response.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    if (Object.keys(query).length) throw new BadRequestException('帧接口不接受查询参数');
    if (!request.user) throw new Error('Authenticated user missing');
    const { bytes, geometry } = await this.frames.read(request.user, this.bearer(request), token, request.ip ?? 'unknown');
    response.set('X-Frame-Geometry', JSON.stringify(geometry));
    response.type('image/png').send(bytes);
  }
  private bearer(request: AuthenticatedRequest) { return request.headers.authorization!.match(/^Bearer (\S+)$/)![1]!; }
}
