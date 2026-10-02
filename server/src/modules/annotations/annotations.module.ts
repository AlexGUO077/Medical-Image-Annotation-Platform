import { Body, Controller, Get, Header, Module, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { OrthancService } from '../cases/orthanc.service';
import { AnnotationsService } from './annotations.service';
@Controller('cases/:caseId/annotations')
@UseGuards(AccessTokenGuard)
export class AnnotationsController {
  constructor(private readonly annotations: AnnotationsService) {}
  @Get()
  @Header('Cache-Control','no-store, private')
  read(@Req() req: AuthenticatedRequest, @Param('caseId') id: string, @Query('version') version: unknown) {
    if (!req.user) throw new Error('Authenticated user missing');
    return this.annotations.read(req.user,id,version,req.ip ?? 'unknown');
  }
  @Put()
  @Header('Cache-Control','no-store, private')
  save(@Req() req: AuthenticatedRequest, @Param('caseId') id: string, @Body() body: unknown) {
    if (!req.user) throw new Error('Authenticated user missing');
    return this.annotations.save(req.user,id,body,req.ip ?? 'unknown');
  }
}
@Controller('cases/:caseId/submit')
@UseGuards(AccessTokenGuard)
export class AnnotationSubmitController {
 constructor(private readonly annotations:AnnotationsService){}
 @Post()
 @Header('Cache-Control','no-store, private')
 submit(@Req() req:AuthenticatedRequest,@Param('caseId') id:string,@Body() body:unknown){
  if(!req.user)throw new Error('Authenticated user missing');
  return this.annotations.submit(req.user,id,body,req.ip??'unknown');
 }
}
@Module({ imports: [AuthModule], controllers: [AnnotationsController, AnnotationSubmitController], providers: [AnnotationsService, OrthancService] })
export class AnnotationsModule {}
