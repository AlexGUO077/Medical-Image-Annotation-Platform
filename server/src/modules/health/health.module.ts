import { Module } from '@nestjs/common';
import { HEALTH_DEPENDENCIES, loadDependencies } from './dependency.config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PortProbeService } from './port-probe.service';

@Module({
  controllers: [HealthController],
  providers: [
    PortProbeService,
    HealthService,
    {
      provide: HEALTH_DEPENDENCIES,
      useFactory: () => loadDependencies(process.env)
    }
  ]
})
export class HealthModule {}
