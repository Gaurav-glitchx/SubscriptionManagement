import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Refund } from './refund.entity';
import { RefundsService } from './refunds.service';
import { RefundsController } from './refunds.controller';
import { StripeModule } from '../stripe/stripe.module';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Refund]),
    forwardRef(() => StripeModule),
    MailerModule,
  ],
  providers: [RefundsService],
  controllers: [RefundsController],
  exports: [RefundsService],
})
export class RefundsModule {}
