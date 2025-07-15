import { forwardRef, Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlansModule } from '../plans/plans.module';
import { LoggingModule } from '../logging/logging.module';
import { RefundsModule } from '../refunds/refunds.module';

@Module({
  imports: [
    forwardRef(() => SubscriptionsModule),
    PlansModule,
    LoggingModule,
    RefundsModule,
  ],
  providers: [StripeService],
  controllers: [StripeController],
  exports: [StripeService],
})
export class StripeModule {}
