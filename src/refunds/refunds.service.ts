import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Refund } from './refund.entity';
import { StripeService } from '../stripe/stripe.service';
import { MailerService } from '../mailer/mailer.service';
import axios from 'axios';

@Injectable()
export class RefundsService {
  constructor(
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
    @Inject(forwardRef(() => StripeService))
    private readonly stripeService: StripeService,
    private readonly mailerService: MailerService,
  ) {}

  /**
   * Sync a Stripe refund event to the database.
   * @param stripeRefund Stripe refund object
   * @returns Refund
   */
  async syncRefundFromStripe(stripeRefund: any) {
    if (!stripeRefund.id?.startsWith('re_')) {
      return;
    }
    let refund = await this.refundRepository.findOne({
      where: { stripeRefundId: stripeRefund.id },
    });
    const data = {
      stripePaymentIntentId: stripeRefund.payment_intent,
      amount: stripeRefund.amount / 100,
      currency: stripeRefund.currency,
      status: stripeRefund.status,
    };
    if (refund) {
      await this.refundRepository.update(refund.id, data);
      return this.refundRepository.findOne({ where: { id: refund.id } });
    } else {
      refund = this.refundRepository.create({
        stripeRefundId: stripeRefund.id,
        ...data,
      });
      return this.refundRepository.save(refund);
    }
  }

  /**
   * Get all refunds from the database.
   * @returns List of refunds
   */
  async findAll(): Promise<Refund[]> {
    return this.refundRepository.find();
  }

  /**
   * Get paginated refunds from the database.
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated refunds
   */
  async findAllPaginated(page = 1, limit = 10) {
    const [data, total] = await this.refundRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    const totalPages = Math.ceil(total / limit);
    return { total, page, limit, totalPages, data };
  }

  /**
   * Create a refund in Stripe and save it in the database.
   * @param paymentIntentId Stripe payment intent ID
   * @param amount Amount to refund (optional)
   * @returns Refund
   */
  async createRefund(paymentIntentId: string, amount?: number) {
    const stripe = this.stripeService.getStripeInstance();
    const stripeRefund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount ? Math.round(amount * 100) : undefined,
    });
    const refund = this.refundRepository.create({
      stripeRefundId: stripeRefund.id ?? undefined,
      stripePaymentIntentId: paymentIntentId ?? undefined,
      amount: stripeRefund.amount / 100,
      currency: stripeRefund.currency ?? undefined,
      status: stripeRefund.status ?? undefined,
    });
    const savedRefund = await this.refundRepository.save(refund);

    let email = undefined;
    let attachments = [];
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['invoice', 'customer'],
      });
      const piCustomer = (pi as any).customer;
      if (piCustomer) {
        const customerId =
          typeof piCustomer === 'string' ? piCustomer : piCustomer.id;
        const customer = await stripe.customers.retrieve(customerId);
        email = (customer as any).email;
      }
      const piInvoice = (pi as any).invoice;
      if (piInvoice) {
        const invoiceId =
          typeof piInvoice === 'string' ? piInvoice : piInvoice.id;
        const invoice = await stripe.invoices.retrieve(invoiceId);
        if (invoice && (invoice as any).invoice_pdf) {
          const response = await axios.get((invoice as any).invoice_pdf, {
            responseType: 'arraybuffer',
          });
          attachments.push({
            filename: 'invoice.pdf',
            content: Buffer.from(response.data),
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch invoice PDF for refund:', e);
    }
    if (email) {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Refund Issued',
        text: `A refund of $${refund.amount.toFixed(2)} has been issued to your account.`,
        html: `<p>A refund of <b>$${refund.amount.toFixed(2)}</b> has been issued to your account.</p>`,
        attachments,
      });
    }
    return savedRefund;
  }
}
