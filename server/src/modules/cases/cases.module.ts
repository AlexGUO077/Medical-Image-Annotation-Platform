import { ObjectStorageModule } from './object-storage.module';
import { AuthModule } from '../auth/auth.module';
import { CasesClinicalService } from './cases-clinical.service';
import { CasesAttachmentsService } from './cases-attachments.service';
import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesImportService } from './cases-import.service';
import { DeidWorkerService } from './deid-worker.service';
import { ImportStoreService } from './import-store.service';
import { OrthancService } from './orthanc.service';
import { CasesManualService } from './cases-manual.service';
import { CasesLifecycleModule } from './cases-lifecycle.module';

@Module({
  imports: [AuthModule, CasesLifecycleModule, ObjectStorageModule],
  controllers: [CasesController],
  providers: [CasesClinicalService, CasesAttachmentsService, CasesImportService, CasesManualService, DeidWorkerService, ImportStoreService, OrthancService],
})
export class CasesModule {}
