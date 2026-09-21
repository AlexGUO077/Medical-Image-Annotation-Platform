import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { diskStorage } from 'multer';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { IMPORT_QUARANTINE_ROOT } from './cases-import.paths';
import { CasesImportService } from './cases-import.service';

@Controller('cases')
@UseGuards(AccessTokenGuard, AdminGuard)
export class CasesController {
  constructor(private readonly imports: CasesImportService) {}

  @Post('import')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_request, _file, callback) => {
        mkdirSync(IMPORT_QUARANTINE_ROOT, { recursive: true, mode: 0o700 });
        callback(null, IMPORT_QUARANTINE_ROOT);
      },
      filename: (_request, _file, callback) => callback(null, `${randomUUID()}.zip`),
    }),
    fileFilter: (_request, file, callback) => {
      const allowedMime = new Set(['application/zip', 'application/x-zip-compressed', 'application/octet-stream']);
      if (!file.originalname.toLowerCase().endsWith('.zip') || !allowedMime.has(file.mimetype)) {
        callback(new UnsupportedMediaTypeException('只允许上传 ZIP 文件'), false);
        return;
      }
      callback(null, true);
    },
    limits: {
      fileSize: 512 * 1024 * 1024,
      files: 1,
      fields: 2,
      fieldNameSize: 64,
      fieldSize: 256,
      parts: 3,
    },
  }))
  importCases(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('source') source: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imports.acceptUpload(this.actor(request), file, source, request.ip ?? 'unknown');
  }

  @Get('import/:batchId')
  importProgress(@Param('batchId') batchId: string) {
    return this.imports.progress(batchId);
  }

  @Get('import/:batchId/items/:itemId/preview')
  async importPreview(
    @Param('batchId') batchId: string,
    @Param('itemId') itemId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const image = await this.imports.preview(batchId, itemId, this.actor(request));
    response
      .status(200)
      .set({
        'Cache-Control': 'no-store, private',
        'Content-Disposition': 'inline',
        'Content-Type': 'image/png',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(image);
  }

  @Post('import/:batchId/items/:itemId/confirm')
  importConfirm(
    @Param('batchId') batchId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imports.confirm(batchId, itemId, this.actor(request), body, request.ip ?? 'unknown');
  }

  @Post(':caseId/mask-map/audit')
  auditMaskMap(
    @Param('caseId') caseId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imports.auditMaskMap(caseId, this.actor(request), body, request.ip ?? 'unknown');
  }

  private actor(request: AuthenticatedRequest) {
    if (!request.user) throw new Error('Authenticated user missing');
    return request.user;
  }
}
