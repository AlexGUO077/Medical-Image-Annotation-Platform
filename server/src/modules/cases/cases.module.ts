import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesImportService } from './cases-import.service';
import { DeidWorkerService } from './deid-worker.service';
import { ImportStoreService } from './import-store.service';
import { MaskMapService } from './mask-map.service';
import { OrthancService } from './orthanc.service';

@Module({
  controllers: [CasesController],
  providers: [CasesImportService, DeidWorkerService, ImportStoreService, MaskMapService, OrthancService],
})
export class CasesModule {}
