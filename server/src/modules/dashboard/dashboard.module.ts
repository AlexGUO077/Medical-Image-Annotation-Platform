import { Controller, Get, Header, Module, Query, Req, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(AccessTokenGuard, AdminGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}
  @Get()
  @Header('Cache-Control', 'no-store, private')
  read(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    if (!req.user) throw Error('Authenticated user missing');
    return this.stats.read(req.user, query);
  }
}
@Module({imports:[AuthModule],controllers:[StatsController],providers:[StatsService]})
export class DashboardModule {}
