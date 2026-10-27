import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrthancService } from '../cases/orthanc.service';
import { EducationController, EducationActivationController } from './education.controller';
import { EducationService } from './education.service';
@Module({imports:[AuthModule],controllers:[EducationController,EducationActivationController],providers:[EducationService,OrthancService]})
export class EducationModule {}
