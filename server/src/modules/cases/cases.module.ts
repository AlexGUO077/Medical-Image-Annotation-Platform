import { AuthModule } from '../auth/auth.module';
import { ObjectCompensationService } from './object-compensation.service';
import { CasesClinicalService } from './cases-clinical.service';
import { CasesAttachmentsService } from './cases-attachments.service';
import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesImportService } from './cases-import.service';
import { DeidWorkerService } from './deid-worker.service';
import { ImportStoreService } from './import-store.service';
import { MaskMapService } from './mask-map.service';
import { OrthancService } from './orthanc.service';
import { CasesManualService } from './cases-manual.service';
import { AttachmentObjectService } from './attachment-object.service';

@Module({
  imports: [AuthModule],
  controllers: [CasesController],
  providers: [ObjectCompensationService, CasesClinicalService, CasesAttachmentsService, CasesImportService, CasesManualService, AttachmentObjectService, DeidWorkerService, ImportStoreService, MaskMapService, OrthancService],
})
export class CasesModule {}
