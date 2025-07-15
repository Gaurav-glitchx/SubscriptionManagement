import { Controller, Get, Query } from '@nestjs/common';
import { PlansService } from './plans.service';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'Get all plans and prices' })
  @ApiOkResponse({ description: 'List of all plans and prices.' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default 10)',
  })
  async getAllPlans(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.plansService.findAllPaginated(Number(page), Number(limit));
  }
}
