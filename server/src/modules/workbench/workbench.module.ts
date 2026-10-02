import { BadRequestException, Controller, Get, Header, Module, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AttachmentObjectService } from '../cases/attachment-object.service';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { WorkbenchService } from './workbench.service';
@Controller('workbench')
@UseGuards(AccessTokenGuard)
export class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}
  @Get(':caseId/attachments/:attachmentId/preview')
  async attachment(@Req() request:AuthenticatedRequest,@Param('caseId') id:string,@Param('attachmentId') attachment:string,@Query() query:Record<string,unknown>,@Res() response:Response){
    response.set({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    if(Object.keys(query).some(k=>k!=='page'))throw new BadRequestException('附件预览参数无效');
    if(!request.user)throw new Error('Authenticated user missing');
    const result=await this.workbench.attachment(request.user,id,attachment,query.page,request.ip??'unknown');
    response.set('X-Page-Count',String(result.page_count)).type('image/png').send(result.image);
  }
  @Get(':caseId')
  @Header('Cache-Control','no-store, private')
  read(@Req() request: AuthenticatedRequest, @Param('caseId') id: string) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.workbench.read(request.user,id,request.ip ?? 'unknown');
  }
}
@Module({ imports: [AuthModule], controllers: [WorkbenchController], providers: [WorkbenchService, AttachmentObjectService] })
export class WorkbenchModule {}
