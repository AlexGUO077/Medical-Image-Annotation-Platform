import {Controller,Get,Header,Module,Query,Req,UseGuards} from '@nestjs/common';
import {AuthModule} from '../auth/auth.module';
import {AccessTokenGuard} from '../auth/access-token.guard';
import {AdminGuard} from '../auth/admin.guard';
import type {AuthenticatedRequest} from '../auth/auth.models';
import {AuditQueryService} from './audit-query.service';
@Controller('audit') @UseGuards(AccessTokenGuard,AdminGuard)
export class AuditController {
 constructor(private readonly service:AuditQueryService){}
 @Get() @Header('Cache-Control','no-store, private') list(@Req()r:AuthenticatedRequest,@Query()q:Record<string,unknown>){return this.service.list(r.user!,q);}
}
@Module({imports:[AuthModule],controllers:[AuditController],providers:[AuditQueryService]})
export class AuditModule{}
