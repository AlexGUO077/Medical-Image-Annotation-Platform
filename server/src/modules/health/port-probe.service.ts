import { Injectable } from '@nestjs/common';
import { createConnection } from 'node:net';
import type { DependencyTarget } from './dependency.config';

export interface PortProbe {
  check(target: DependencyTarget): Promise<void>;
}

@Injectable()
export class PortProbeService implements PortProbe {
  private readonly timeoutMs = 750;

  check({ host, port }: DependencyTarget): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      let settled = false;
      const timeout = setTimeout(() => finish(new Error('TCP probe timed out')), this.timeoutMs);

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        socket.removeAllListeners();
        socket.destroy();

        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      socket.once('connect', () => finish());
      socket.once('error', (error) => finish(error));
    });
  }
}
