import { Body, Controller, Header, Module, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { CasesLifecycleService } from './cases-lifecycle.service';
@Controller('cases/:caseId')
@UseGuards(AccessTokenGuard,AdminGuard)
export class CasesLifecycleController {
  constructor(private readonly lifecycle:CasesLifecycleService){}
  @Post('offline')
  @Header('Cache-Control','no-store, private')
  offline(@Req() req:AuthenticatedRequest,@Param('caseId') id:string,@Body() body:unknown){
    if(!req.user)throw new Error('Authenticated user missing');
    return this.lifecycle.change(req.user,id,body,'offline',req.ip??'unknown');
  }
  @Post('reactivate')
  @Header('Cache-Control','no-store, private')
  reactivate(@Req() req:AuthenticatedRequest,@Param('caseId') id:string,@Body() body:unknown){
    if(!req.user)throw new Error('Authenticated user missing');
    return this.lifecycle.change(req.user,id,body,'reactivate',req.ip??'unknown');
  }
}
@Module({imports:[AuthModule],controllers:[CasesLifecycleController],providers:[CasesLifecycleService]})
export class CasesLifecycleModule {}
