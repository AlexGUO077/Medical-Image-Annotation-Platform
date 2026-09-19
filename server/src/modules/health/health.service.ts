import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HEALTH_DEPENDENCIES, type DependencyTarget } from './dependency.config';
import { PortProbeService, type PortProbe } from './port-probe.service';

@Injectable()
export class HealthService {
  constructor(
    @Inject(PortProbeService) private readonly portProbe: PortProbe,
    @Inject(HEALTH_DEPENDENCIES) private readonly dependencies: readonly DependencyTarget[]
  ) {}

  async ready(): Promise<{ status: 'ok'; dependencies: Record<string, 'up'> }> {
    const dependencies: Record<string, 'up'> = {};

    for (const dependency of this.dependencies) {
      try {
        await this.portProbe.check(dependency);
      } catch {
        throw new ServiceUnavailableException({ status: 'error', dependency: dependency.name });
      }
      dependencies[dependency.name] = 'up';
    }

    return { status: 'ok', dependencies };
  }
}
