import {
  Controller,
  Post,
  Req,
  Res,
  Headers,
  HttpCode,
  Get,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { StripeService } from './stripe.service';
import { ApiTags, ApiOperation, ApiBody, ApiOkResponse } from '@nestjs/swagger';

@ApiTags('Stripe')
@Controller('webhooks/stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @Get('health')
  @HttpCode(200)
  healthCheck() {
    return { status: 'ok', message: 'Stripe webhook endpoint is reachable.' };
  }

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('stripe-signature') sig: string,
  ) {
    return this.stripeService.handleWebhook(req, res, sig);
  }
}
