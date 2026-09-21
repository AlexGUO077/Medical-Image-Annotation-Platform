import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ResponseLike>();
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
