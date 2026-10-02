import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { MulterError } from 'multer';
import { describe, expect, it, vi } from 'vitest';
import { SubmissionValidationException } from './submission-validation.exception';
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
  it('only exposes structured submission issues from the dedicated exception', () => {
    const issues = { objects: [{ id: 'synthetic', fields: ['part_id'] }], sentence_ids: [0] };
    const allowed = host(), generic = host();
    new ApiExceptionFilter().catch(new SubmissionValidationException(issues), allowed.argumentsHost);
    expect(allowed.json).toHaveBeenCalledWith({ code: 'HTTP_400', message: '标注或报告关联不完整', issues });
    new ApiExceptionFilter().catch(new BadRequestException({ message: 'invalid', issues, internal: 'private' }), generic.argumentsHost);
    expect(generic.json).toHaveBeenCalledWith({ code: 'HTTP_400', message: 'invalid' });
  });
  it('maps Multer file-size limits to HTTP 413', () => {
    const { argumentsHost, response, json } = host();

    new ApiExceptionFilter().catch(new MulterError('LIMIT_FILE_SIZE'), argumentsHost);

    expect(response.status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({
      code: 'HTTP_413',
      message: '上传文件超过该接口大小限制',
    });
  });
});
