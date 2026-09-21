import type { ArgumentsHost } from '@nestjs/common';
import { MulterError } from 'multer';
import { describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter';

function host() {
  const json = vi.fn();
  const response = { status: vi.fn(), json };
  response.status.mockReturnValue(response);
  return {
    argumentsHost: {
      switchToHttp: () => ({ getResponse: () => response }),
    } as ArgumentsHost,
    response,
    json,
  };
}

describe('ApiExceptionFilter', () => {
  it('maps Multer file-size limits to HTTP 413', () => {
    const { argumentsHost, response, json } = host();

    new ApiExceptionFilter().catch(new MulterError('LIMIT_FILE_SIZE'), argumentsHost);

    expect(response.status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({
      code: 'HTTP_413',
      message: '上传文件超过 512 MiB 限制',
    });
  });
});
