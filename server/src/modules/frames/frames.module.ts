import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrthancService } from '../cases/orthanc.service';
import { FrameRateService } from './frame-rate.service';
import { FrameRenderCacheService } from './frame-render-cache.service';
import { FramesController } from './frames.controller';
import { FramesService } from './frames.service';

@Module({ imports: [AuthModule], controllers: [FramesController], providers: [FramesService, FrameRateService, FrameRenderCacheService, OrthancService] })
export class FramesModule {}
