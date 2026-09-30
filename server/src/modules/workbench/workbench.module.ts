import { Controller, Get, Header, Module, Param, Req, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { WorkbenchService } from './workbench.service';
@Controller('workbench')
@UseGuards(AccessTokenGuard)
export class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}
  @Get(':caseId')
  @Header('Cache-Control','no-store, private')
  read(@Req() request: AuthenticatedRequest, @Param('caseId') id: string) {
    if (!request.user) throw new Error('Authenticated user missing');
    return this.workbench.read(request.user,id,request.ip ?? 'unknown');
  }
}
@Module({ imports: [AuthModule], controllers: [WorkbenchController], providers: [WorkbenchService] })
export class WorkbenchModule {}
