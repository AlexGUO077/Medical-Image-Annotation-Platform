import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Patch,
  Query,
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
import { diskStorage, memoryStorage } from 'multer';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { IMPORT_QUARANTINE_ROOT, MANUAL_QUARANTINE_ROOT } from './cases-import.paths';
import { CasesImportService } from './cases-import.service';
import { CasesClinicalService } from './cases-clinical.service';
import { CasesAttachmentsService } from './cases-attachments.service';
import { CasesManualService } from './cases-manual.service';

@Controller('cases')
@UseGuards(AccessTokenGuard, AdminGuard)
export class CasesController {
  constructor(private readonly imports: CasesImportService, private readonly manual: CasesManualService,
    private readonly clinical: CasesClinicalService, private readonly attachments: CasesAttachmentsService) {}

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

  @Post('manual/prepare')
  @Header('Cache-Control', 'no-store, private')
  @UseInterceptors(FileInterceptor('image', {
    storage: diskStorage({
      destination: (_request, _file, callback) => {
        mkdirSync(MANUAL_QUARANTINE_ROOT, { recursive: true, mode: 0o700 });
        callback(null, MANUAL_QUARANTINE_ROOT);
      },
      filename: (_request, _file, callback) => callback(null, `${randomUUID()}.upload`),
    }),
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 1,
      fields: 2,
      fieldNameSize: 64,
      fieldSize: 2 * 1024 * 1024,
      parts: 3,
    },
  }))
  manualPrepare(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('source') source: unknown,
    @Body('report_text') report: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.manual.prepare(this.actor(request), file, source, report);
  }

  @Get('manual/:draftId/preview')
  async manualPreview(
    @Param('draftId') draftId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const image = await this.manual.preview(draftId, this.actor(request));
    response.status(200).set({
      'Cache-Control': 'no-store, private',
      'Content-Disposition': 'inline',
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
    }).send(image);
  }

  @Post('manual/:draftId/confirm')
  @Header('Cache-Control', 'no-store, private')
  manualConfirm(
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.manual.confirm(draftId, this.actor(request), body, request.ip ?? 'unknown');
  }

  @Get(':caseId')
  @Header('Cache-Control', 'no-store, private')
  caseDetail(@Param('caseId') caseId: string) {
    return this.manual.caseDetail(caseId);
  }

  @Get(':caseId/report')
  @Header('Cache-Control', 'no-store, private')
  caseReport(@Param('caseId') caseId: string) {
    return this.manual.report(caseId);
  }

  @Get(':caseId/attachments/:attachmentId/preview')
  async attachmentPreview(
    @Param('caseId') caseId: string,
    @Param('attachmentId') attachmentId: string,
    @Query('page') page: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const { image, page_count } = await this.attachments.preview(caseId, attachmentId, page, this.actor(request));
    response.set('X-Preview-Page-Count', String(page_count));
    response.status(200).set({
      'Cache-Control': 'no-store, private',
      'Content-Disposition': 'inline',
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
    }).send(image);
  }

  @Put(':caseId/clinical')
  @Header('Cache-Control', 'no-store, private')
  saveClinical(@Param('caseId') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.clinical.save(id, this.actor(request), body, false, request.ip ?? 'unknown');
  }

  @Patch(':caseId/teaching')
  @Header('Cache-Control', 'no-store, private')
  saveTeaching(@Param('caseId') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.clinical.save(id, this.actor(request), body, true, request.ip ?? 'unknown');
  }

  @Post(':caseId/attachments')
  @Header('Cache-Control', 'no-store, private')
  @UseInterceptors(FileInterceptor('chunk', { storage: memoryStorage(), limits: {
    fileSize: 5 * 1024 * 1024, files: 1, fields: 6, fieldNameSize: 64, fieldSize: 100, parts: 7,
  } }))
  uploadAttachment(@Param('caseId') id: string, @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File | undefined, @Req() request: AuthenticatedRequest) {
    return this.attachments.receive(id, this.actor(request), body, file);
  }

  @Get(':caseId/attachments/uploads/:uploadId')
  @Header('Cache-Control', 'no-store, private')
  attachmentProgress(@Param('caseId') id: string, @Param('uploadId') uploadId: string, @Req() request: AuthenticatedRequest) {
    return this.attachments.progress(id, uploadId, this.actor(request));
  }

  @Get(':caseId/attachments/uploads/:uploadId/preview')
  async pendingAttachmentPreview(@Param('caseId') id: string, @Param('uploadId') uploadId: string,
    @Query('page') page: string | undefined, @Req() request: AuthenticatedRequest, @Res() response: Response) {
    const image = await this.attachments.uploadPreview(id, uploadId, page, this.actor(request));
    response.status(200).set({ 'Cache-Control': 'no-store, private', 'Content-Disposition': 'inline',
      'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff' }).send(image);
  }

  @Post(':caseId/attachments/uploads/:uploadId/confirm')
  @Header('Cache-Control', 'no-store, private')
  confirmAttachment(@Param('caseId') id: string, @Param('uploadId') uploadId: string,
    @Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.attachments.confirm(id, uploadId, this.actor(request), body, request.ip ?? 'unknown');
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
