import { Controller, Get, Inject } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  ready() {
    return this.healthService.ready();
  }

  @Get('live')
  live() {
    return { status: 'ok' as const, service: 'server' as const };
  }
}
