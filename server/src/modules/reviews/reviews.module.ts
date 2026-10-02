import { BadRequestException, Body, Controller, Get, Header, Module, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { WorkbenchService } from '../workbench/workbench.service';
import { AttachmentObjectService } from '../cases/attachment-object.service';
import { ReviewsService } from './reviews.service';
@Controller('reviews')
@UseGuards(AccessTokenGuard)
export class ReviewsController {
  constructor(private readonly reviews:ReviewsService,private readonly workbench:WorkbenchService){}
  @Get(':caseId')
  @Header('Cache-Control','no-store, private')
  read(@Req() req:AuthenticatedRequest,@Param('caseId') id:string,@Query() query:Record<string,unknown>){
    if(Object.keys(query).some(k=>k!=='version'))throw new BadRequestException('审核读取参数无效');
    if(!req.user)throw new Error('Authenticated user missing');
    return this.reviews.read(req.user,id,query.version,req.ip??'unknown');
  }
  @Post(':caseId')
  @Header('Cache-Control','no-store, private')
  decide(@Req() req:AuthenticatedRequest,@Param('caseId') id:string,@Body() body:unknown){
    if(!req.user)throw new Error('Authenticated user missing');
    return this.reviews.decide(req.user,id,body,req.ip??'unknown');
  }
  @Get(':caseId/attachments/:attachmentId/preview')
  async attachment(@Req() req:AuthenticatedRequest,@Param('caseId') id:string,@Param('attachmentId') attachment:string,@Query() query:Record<string,unknown>,@Res() res:Response){
    res.set({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    if(Object.keys(query).some(k=>k!=='page'))throw new BadRequestException('附件预览参数无效');
    if(!req.user)throw new Error('Authenticated user missing');
    const result=await this.workbench.attachment(req.user,id,attachment,query.page,req.ip??'unknown','review');
    res.set('X-Page-Count',String(result.page_count)).type('image/png').send(result.image);
  }
}
@Module({imports:[AuthModule],controllers:[ReviewsController],providers:[ReviewsService,WorkbenchService,AttachmentObjectService]})
export class ReviewsModule {}
