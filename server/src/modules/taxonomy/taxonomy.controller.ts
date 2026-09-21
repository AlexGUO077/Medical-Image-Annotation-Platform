import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { TaxonomyService } from './taxonomy.service';

@Controller('taxonomy')
@UseGuards(AccessTokenGuard)
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get('tree')
  tree() {
    return this.taxonomy.tree();
  }
}
