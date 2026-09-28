import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { MulterError } from 'multer';

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ResponseLike>();
    if (exception instanceof MulterError) {
      const status = exception.code === 'LIMIT_FILE_SIZE'
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : HttpStatus.BAD_REQUEST;
      const message = exception.code === 'LIMIT_FILE_SIZE'
        ? '上传文件超过该接口大小限制'
        : '上传请求不符合限制';
      response.status(status).json({ code: `HTTP_${status}`, message });
      return;
    }
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const source = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = typeof source === 'string'
      ? source
      : this.messageFromObject(source) ?? '服务暂时不可用';
    response.status(status).json({ code: `HTTP_${status}`, message });
  }

  private messageFromObject(source: unknown): string | undefined {
    if (!source || typeof source !== 'object') return undefined;
    const message = (source as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && message.every((item) => typeof item === 'string')) return message.join('；');
    return undefined;
  }
}
