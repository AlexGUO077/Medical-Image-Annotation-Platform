import type { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DeidWorkerService } from './deid-worker.service';

describe('DeidWorkerService error mapping', () => {
  const mapError = (code: string): HttpException => {
    const service = new DeidWorkerService() as unknown as {
      workerException(code: string, message: string): HttpException;
    };
    return service.workerException(code, 'synthetic failure');
  };

  it.each([
    'ZIP_SIZE_LIMIT',
    'ZIP_EXPANDED_SIZE_LIMIT',
    'ZIP_FILE_COUNT_LIMIT',
    'ZIP_RATIO_LIMIT',
  ])('maps %s to HTTP 413', (code) => {
    expect(mapError(code).getStatus()).toBe(413);
  });

  it.each(['ZIP_INVALID', 'UNSUPPORTED_FILE'])('maps %s to HTTP 415', (code) => {
    expect(mapError(code).getStatus()).toBe(415);
  });

  it('keeps other worker validation failures on HTTP 422', () => {
    expect(mapError('DICOM_INVALID').getStatus()).toBe(422);
  });
});
