import {
  Controller,
  Post,
  Body,
  Param,
  Patch,
  Get,
  Query,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all subscriptions' })
  @ApiOkResponse({
    description: 'List of all subscriptions',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          stripeSubscriptionId: { type: 'string' },
          customerId: { type: 'string' },
          status: { type: 'string' },
          currentPeriodEnd: { type: 'string', format: 'date-time' },
          cancelAtPeriodEnd: { type: 'boolean' },
          canceledAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          plan: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              price: { type: 'number' },
              stripePriceId: { type: 'string' },
            },
          },
        },
      },
    },
  })
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
  async getAllSubscriptions(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.subscriptionsService.findAllPaginated(
      Number(page),
      Number(limit),
    );
  }

  @Post('create-payment-session')
  @ApiOperation({
    summary: 'Create a payment session for Stripe Elements subscription flow',
  })
  @ApiBody({
    schema: {
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        priceId: { type: 'string' },
      },
      required: ['name', 'email', 'priceId'],
    },
  })
  @ApiOkResponse({
    description: 'Subscription and PaymentIntent client secret',
    schema: {
      properties: {
        subscriptionId: { type: 'string' },
        clientSecret: { type: 'string' },
        status: { type: 'string' },
      },
    },
  })
  async createPaymentSession(
    @Body() body: { name: string; email: string; priceId: string },
  ) {
    const customer = await this.subscriptionsService.createStripeCustomer(
      body.name,
      body.email,
    );
    return this.subscriptionsService.createPaymentSessionSubscription(
      customer.id,
      body.priceId,
    );
  }

  @Patch(':id/upgrade')
  @ApiOperation({ summary: 'Upgrade a subscription immediately (prorated)' })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiBody({ schema: { properties: { newPlanId: { type: 'string' } } } })
  @ApiOkResponse({ description: 'Subscription upgraded.' })
  async upgrade(@Param('id') id: string, @Body() body: { newPlanId: string }) {
    return this.subscriptionsService.upgradeSubscription(id, body.newPlanId);
  }

  @Patch(':id/downgrade')
  @ApiOperation({
    summary: 'Schedule a subscription downgrade for next billing cycle',
  })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiBody({ schema: { properties: { newPlanId: { type: 'string' } } } })
  @ApiOkResponse({ description: 'Subscription downgrade scheduled.' })
  async downgrade(
    @Param('id') id: string,
    @Body() body: { newPlanId: string },
  ) {
    return this.subscriptionsService.downgradeSubscription(id, body.newPlanId);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a subscription' })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiOkResponse({ description: 'Subscription cancelled.' })
  async cancel(@Param('id') id: string) {
    return this.subscriptionsService.cancelSubscription(id);
  }
}
