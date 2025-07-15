import { Controller, Get, Query } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Refunds')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all refunds' })
  @ApiOkResponse({ description: 'List of all refunds.' })
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
  async getAllRefunds(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.refundsService.findAllPaginated(Number(page), Number(limit));
  }
}
