import { AdminGuard } from '../auth/admin.guard';
import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.models';
import { EducationService } from './education.service';

@Controller('education')
@UseGuards(AccessTokenGuard)
export class EducationController {
  constructor(private readonly service:EducationService){}
  @Get('roster') @UseGuards(AdminGuard) @Header('Cache-Control','no-store, private')
  roster(@Req() r:AuthenticatedRequest,@Query() q:Record<string,unknown>){return this.service.roster(r.user!,q);}
  @Post('roster') @UseGuards(AdminGuard) @Header('Cache-Control','no-store, private')
  createRoster(@Req() r:AuthenticatedRequest,@Body() b:unknown){return this.service.createRoster(r.user!,b,r.ip??'unknown');}
  @Post('roster/:id/activation') @UseGuards(AdminGuard) @Header('Cache-Control','no-store, private')
  reissue(@Req() r:AuthenticatedRequest,@Param('id') id:string){return this.service.reissue(r.user!,id,r.ip??'unknown');}
  @Get('candidates') @UseGuards(AdminGuard) @Header('Cache-Control','no-store, private')
  candidates(@Req() r:AuthenticatedRequest,@Query() q:Record<string,unknown>){return this.service.candidates(r.user!,q);}
  @Get('tasks') @Header('Cache-Control','no-store, private')
  tasks(@Req() r:AuthenticatedRequest,@Query() q:Record<string,unknown>){return this.service.tasks(r.user!,q);}
  @Post('tasks') @UseGuards(AdminGuard) @Header('Cache-Control','no-store, private')
  createTask(@Req() r:AuthenticatedRequest,@Body() b:unknown){return this.service.createTask(r.user!,b,r.ip??'unknown');}
  @Patch('tasks/:id') @UseGuards(AdminGuard) @Header('Cache-Control','no-store, private')
  taskState(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:unknown){return this.service.taskState(r.user!,id,b,r.ip??'unknown');}
  @Get('tasks/:id/submissions') @UseGuards(AdminGuard) @Header('Cache-Control','no-store, private')
  submissions(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.submissions(r.user!,id,q);}
  @Post('items/:id/attempts') @Header('Cache-Control','no-store, private')
  start(@Req() r:AuthenticatedRequest,@Param('id') id:string){return this.service.start(r.user!,id,r.ip??'unknown');}
  @Get('attempts/:id/workbench') @Header('Cache-Control','no-store, private')
  workbench(@Req() r:AuthenticatedRequest,@Param('id') id:string){return this.service.workbench(r.user!,id,r.ip??'unknown');}
  @Put('attempts/:id/draft') @Header('Cache-Control','no-store, private')
  save(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:unknown){return this.service.save(r.user!,id,b,r.ip??'unknown');}
  @Post('attempts/:id/submit') @Header('Cache-Control','no-store, private')
  submit(@Req() r:AuthenticatedRequest,@Param('id') id:string,@Body() b:unknown){return this.service.submit(r.user!,id,b,r.ip??'unknown');}
  @Get('attempts/:id/feedback') @Header('Cache-Control','no-store, private')
  feedback(@Req() r:AuthenticatedRequest,@Param('id') id:string){return this.service.workbench(r.user!,id,r.ip??'unknown',true);}
}
@Controller('education')
export class EducationActivationController {
  constructor(private readonly service:EducationService){}
  @Post('activate') @HttpCode(200) @Header('Cache-Control','no-store, private')
  activate(@Body() b:unknown,@Req() r:AuthenticatedRequest){return this.service.activate(b,r.ip??'unknown');}
}
