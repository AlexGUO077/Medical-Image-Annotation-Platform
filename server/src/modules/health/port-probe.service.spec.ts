import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { vi } from 'vitest';
import type { DependencyTarget } from './dependency.config';
import { PortProbeService } from './port-probe.service';

const net = vi.hoisted(() => ({ createConnection: vi.fn() }));

vi.mock('node:net', () => ({ createConnection: net.createConnection }));

const target: DependencyTarget = { name: 'postgres', host: 'postgres.internal.test', port: 5432 };

function pendingSocket(): Socket {
  const socket = new EventEmitter();
  Object.assign(socket, { destroy: vi.fn() });
  return socket as Socket;
}

describe('PortProbeService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('rejects a TCP probe that has not connected within 750 milliseconds', async () => {
    vi.useFakeTimers();
    net.createConnection.mockReturnValue(pendingSocket());
    const probe = new PortProbeService();
    const result = probe.check(target).then(
      () => 'resolved',
      () => 'rejected'
    );

    await vi.advanceTimersByTimeAsync(749);
    await expect(Promise.race([result, Promise.resolve('pending')])).resolves.toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('rejected');
  });
});
