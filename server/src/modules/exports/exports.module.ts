import {Body,Controller,Get,Header,Module,Param,Post,Query,Req,Res,UseGuards,BadRequestException} from '@nestjs/common';
import type {Response} from 'express';
import {AuthModule} from '../auth/auth.module';
import {AccessTokenGuard} from '../auth/access-token.guard';
import {AdminGuard} from '../auth/admin.guard';
import type {AuthenticatedRequest} from '../auth/auth.models';
import {ObjectStorageModule} from '../cases/object-storage.module';
import {OrthancService} from '../cases/orthanc.service';
import {ExportsService} from './exports.service';
@Controller('exports')
@UseGuards(AccessTokenGuard,AdminGuard)
export class ExportsController {
 constructor(private readonly service:ExportsService){}
 @Get('candidates') @Header('Cache-Control','no-store, private') candidates(@Req()r:AuthenticatedRequest,@Query()q:Record<string,unknown>){return this.service.candidates(r.user!,q);}
 @Get() @Header('Cache-Control','no-store, private') list(@Req()r:AuthenticatedRequest,@Query()q:Record<string,unknown>){return this.service.list(r.user!,q);}
 @Post() @Header('Cache-Control','no-store, private') create(@Req()r:AuthenticatedRequest,@Body()b:unknown,@Query()q:Record<string,unknown>){this.noQuery(q);return this.service.create(r.user!,b,r.ip??'unknown');}
 @Post(':id/approve') @Header('Cache-Control','no-store, private') decide(@Req()r:AuthenticatedRequest,@Param('id')id:string,@Body()b:unknown,@Query()q:Record<string,unknown>){this.noQuery(q);return this.service.decide(r.user!,id,b,r.ip??'unknown');}
 @Get(':id/download') async download(@Req()r:AuthenticatedRequest,@Param('id')id:string,@Query()q:Record<string,unknown>,@Res()res:Response){
  res.set({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});this.noQuery(q);
  const bytes=await this.service.download(r.user!,id,r.ip??'unknown');res.set('Content-Disposition',`attachment; filename="synthetic-export-${id}.json"`).type('application/json').send(bytes);
 }
 private noQuery(q:Record<string,unknown>){if(Object.keys(q).length)throw new BadRequestException('接口不接受查询参数');}
}
@Module({imports:[AuthModule,ObjectStorageModule],controllers:[ExportsController],providers:[ExportsService,OrthancService]})
export class ExportsModule{}
