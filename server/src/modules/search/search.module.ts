import { BadRequestException, Controller, Get, Header, Module, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { WorkbenchService } from '../workbench/workbench.service';
import { AttachmentObjectService } from '../cases/attachment-object.service';
import { SearchService } from './search.service';
import { ElasticService } from './elastic.service';
import { SearchSyncService } from './search-sync.service';
@Controller('search')
@UseGuards(AccessTokenGuard)
export class SearchController {
 constructor(private readonly search:SearchService){}
 @Get() @Header('Cache-Control','no-store, private')
 read(@Req() req:AuthenticatedRequest,@Query() query:Record<string,unknown>){if(!req.user)throw Error('Authenticated user missing');return this.search.search(req.user,query);}
}
@Controller('library')
@UseGuards(AccessTokenGuard)
export class LibraryController {
 constructor(private readonly search:SearchService,private readonly workbench:WorkbenchService){}
 @Get(':caseId') @Header('Cache-Control','no-store, private')
 read(@Req() req:AuthenticatedRequest,@Param('caseId') id:string,@Query() query:Record<string,unknown>){
  if(Object.keys(query).length)throw new BadRequestException('只读库参数无效');if(!req.user)throw Error('Authenticated user missing');return this.search.read(req.user,id,req.ip??'unknown');
 }
 @Get(':caseId/attachments/:attachmentId/preview')
 async attachment(@Req() req:AuthenticatedRequest,@Param('caseId') id:string,@Param('attachmentId') attachment:string,@Query() query:Record<string,unknown>,@Res() res:Response){
  res.set({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
  if(Object.keys(query).some(k=>!['page','version'].includes(k))||typeof query.version!=='string'||!/^\d+$/.test(query.version)||!Number.isSafeInteger(Number(query.version)))throw new BadRequestException('附件版本参数无效');
  if(!req.user)throw Error('Authenticated user missing');
  const result=await this.workbench.attachment(req.user,id,attachment,query.page,req.ip??'unknown','library',Number(query.version));
  res.set('X-Page-Count',String(result.page_count)).type('image/png').send(result.image);
 }
}
@Module({imports:[AuthModule],controllers:[SearchController,LibraryController],providers:[SearchService,ElasticService,SearchSyncService,WorkbenchService,AttachmentObjectService]})
export class SearchModule {}
