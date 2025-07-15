import {
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Subscription } from './subscription.entity';
import { Plan } from '../plans/plan.entity';
import { StripeService } from '../stripe/stripe.service';
import { RefundsService } from '../refunds/refunds.service';
import { validate as isUuid } from 'uuid';
import Stripe from 'stripe';
import { MailerService } from '../mailer/mailer.service';
import axios from 'axios';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
    @Inject(forwardRef(() => StripeService))
    private readonly stripeService: StripeService,
    @Inject(forwardRef(() => RefundsService))
    private readonly refundsService: RefundsService,
    private readonly mailerService: MailerService,
  ) {}

  private async getSubscriptionForUpgrade(
    subscriptionId: string,
  ): Promise<Subscription> {
    let sub: Subscription | null = null;
    if (isUuid(subscriptionId)) {
      sub = await this.subscriptionRepository.findOne({
        where: { id: subscriptionId },
        relations: ['plan'],
      });
    } else {
      sub = await this.subscriptionRepository.findOne({
        where: { stripeSubscriptionId: subscriptionId },
        relations: ['plan'],
      });
    }
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  private async getPlanForUpgrade(newPlanId: string): Promise<Plan> {
    let newPlan: Plan | null = null;
    if (isUuid(newPlanId)) {
      newPlan = await this.planRepository.findOne({ where: { id: newPlanId } });
    } else {
      newPlan = await this.planRepository.findOne({
        where: { stripePriceId: newPlanId },
      });
    }
    if (!newPlan) throw new NotFoundException('Plan not found');
    return newPlan;
  }

  private async handleProrationInvoice(stripe: any, stripeId: string) {
    const invoices = await stripe.invoices.list({
      subscription: stripeId,
      status: 'open',
      limit: 10,
    });
    let prorationInvoice = invoices.data.find(
      (inv: any) =>
        inv.billing_reason === 'subscription_update' ||
        inv.lines?.data?.some((line: any) => line.proration),
    );
    if (
      prorationInvoice &&
      prorationInvoice.status === 'open' &&
      prorationInvoice.id
    ) {
      prorationInvoice = await stripe.invoices.finalizeInvoice(
        prorationInvoice.id,
      );
      if (typeof prorationInvoice.id === 'string') {
        await stripe.invoices.pay(prorationInvoice.id);
      }
    }
    return prorationInvoice;
  }

  private async updateSubscriptionInDb(
    sub: Subscription,
    newPlan: Plan,
    stripeSub: any,
  ) {
    sub.plan = newPlan;
    sub.status = stripeSub.status;
    sub.currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
    sub.cancelAtPeriodEnd = stripeSub.cancel_at_period_end;
    return this.subscriptionRepository.save(sub);
  }

  private async sendUpgradeEmail(
    sub: Subscription,
    newPlan: Plan,
    prorationInvoice: any,
  ) {
    const stripe = this.stripeService.getStripeInstance();
    const customer = await stripe.customers.retrieve(sub.customerId);
    const email = (customer as any).email;
    let attachments = [];
    if (prorationInvoice?.invoice_pdf) {
      try {
        const response = await axios.get(prorationInvoice.invoice_pdf, {
          responseType: 'arraybuffer',
        });
        attachments.push({
          filename: 'invoice.pdf',
          content: Buffer.from(response.data),
        });
      } catch (e) {
        console.error('Failed to fetch invoice PDF:', e);
      }
    }
    if (email) {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Subscription Upgraded',
        text: `Your subscription has been upgraded to ${newPlan.name}.`,
        html: `<p>Your subscription has been upgraded to <b>${newPlan.name}</b>.</p>`,
        attachments,
      });
    }
  }

  private async getSubscriptionForDowngrade(
    subscriptionId: string,
  ): Promise<Subscription> {
    let sub: Subscription | null = null;
    if (isUuid(subscriptionId)) {
      sub = await this.subscriptionRepository.findOne({
        where: { id: subscriptionId },
        relations: ['plan', 'pendingPlan'],
      });
    } else {
      sub = await this.subscriptionRepository.findOne({
        where: { stripeSubscriptionId: subscriptionId },
        relations: ['plan', 'pendingPlan'],
      });
    }
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  private async getPlanForDowngrade(newPriceId: string): Promise<Plan> {
    const newPlan = await this.planRepository.findOne({
      where: { stripePriceId: newPriceId },
    });
    if (!newPlan) throw new NotFoundException('New plan not found');
    return newPlan;
  }

  private async createStripeSchedule(sub: Subscription, newPriceId: string) {
    const stripe = this.stripeService.getStripeInstance();
    const subscription: any = await stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
    );
    const currentPriceId = subscription.items.data[0].price.id;
    const startTimestamp = subscription.current_period_start;
    const endTimestamp = subscription.current_period_end;
    if (!startTimestamp || !endTimestamp || startTimestamp >= endTimestamp) {
      throw new Error(
        `Invalid phase timing: start (${startTimestamp}) >= end (${endTimestamp})`,
      );
    }
    const subscriptionSchedule = await stripe.subscriptionSchedules.create({
      from_subscription: sub.stripeSubscriptionId,
    });
    return stripe.subscriptionSchedules.update(subscriptionSchedule.id, {
      end_behavior: 'release',
      phases: [
        {
          items: [{ price: currentPriceId, quantity: 1 }],
          start_date: startTimestamp,
          end_date: endTimestamp,
        },
        {
          items: [{ price: newPriceId, quantity: 1 }],
          start_date: endTimestamp,
        },
      ],
    });
  }

  private async savePendingPlan(sub: Subscription, newPlan: Plan) {
    sub.pendingPlanId = newPlan.id;
    sub.pendingPlan = newPlan;
    await this.subscriptionRepository.save(sub);
  }

  private async sendDowngradeEmail(
    sub: Subscription,
    newPlan: Plan,
    schedule: any,
  ) {
    const stripe = this.stripeService.getStripeInstance();
    const customer = await stripe.customers.retrieve(sub.customerId);
    const email = (customer as any).email;
    let attachments = [];
    const subscription: any = await stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
    );
    if (subscription.latest_invoice) {
      const invoiceId =
        typeof subscription.latest_invoice === 'string'
          ? subscription.latest_invoice
          : subscription.latest_invoice.id;
      if (invoiceId) {
        const invoice: any = await stripe.invoices.retrieve(invoiceId);
        if (invoice?.invoice_pdf) {
          try {
            const response = await axios.get(invoice.invoice_pdf, {
              responseType: 'arraybuffer',
            });
            attachments.push({
              filename: 'invoice.pdf',
              content: Buffer.from(response.data),
            });
          } catch (e) {
            console.error('Failed to fetch invoice PDF:', e);
          }
        }
      }
    }
    if (email) {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Subscription Downgrade Scheduled',
        text: `Your subscription will be downgraded to ${newPlan.name} at the next billing cycle.`,
        html: `<p>Your subscription will be downgraded to <b>${newPlan.name}</b> at the next billing cycle.</p>`,
        attachments,
      });
    }
  }

  /**
   * Upgrade a subscription to a higher-priced plan right away.
   * @param subscriptionId Subscription ID or Stripe ID
   * @param newPlanId New plan ID or Stripe price ID
   * @returns Updated subscription
   */
  async upgradeSubscription(subscriptionId: string, newPlanId: string) {
    const sub = await this.getSubscriptionForUpgrade(subscriptionId);
    const newPlan = await this.getPlanForUpgrade(newPlanId);
    if (Number(sub.plan.amount) >= Number(newPlan.amount)) {
      throw new BadRequestException('Upgrade must be to a higher-priced plan.');
    }
    const stripeSub: any = await this.stripeService.updateStripeSubscription(
      sub.stripeSubscriptionId,
      newPlan.stripePriceId,
      true,
    );
    await this.updateSubscriptionInDb(sub, newPlan, stripeSub);
    const stripe = this.stripeService.getStripeInstance();
    const prorationInvoice = await this.handleProrationInvoice(
      stripe,
      sub.stripeSubscriptionId,
    );
    await this.sendUpgradeEmail(sub, newPlan, prorationInvoice);
    return sub;
  }

  /**
   * Schedule a downgrade to a lower-priced plan for next cycle.
   * @param subscriptionId Subscription ID or Stripe ID
   * @param newPriceId New Stripe price ID
   * @returns Stripe subscription schedule
   */
  async downgradeSubscription(
    subscriptionId: string,
    newPriceId: string,
  ): Promise<Stripe.SubscriptionSchedule> {
    const sub = await this.getSubscriptionForDowngrade(subscriptionId);
    const newPlan = await this.getPlanForDowngrade(newPriceId);
    const schedule = await this.createStripeSchedule(sub, newPriceId);
    await this.savePendingPlan(sub, newPlan);
    await this.sendDowngradeEmail(sub, newPlan, schedule);
    return schedule;
  }

  /**
   * Cancel a subscription and handle refund if needed.
   * @param subscriptionId Subscription ID or Stripe ID
   * @returns Canceled subscription
   */
  async cancelSubscription(subscriptionId: string) {
    const sub = await this.findSubscriptionForCancel(subscriptionId);
    const stripeSub = await this.getStripeSubscription(
      sub.stripeSubscriptionId,
    );
    await this.cancelScheduleIfNeeded(stripeSub, sub);
    const { paymentIntentId, refundAmount } = this.calculateRefund(stripeSub);
    if (paymentIntentId && refundAmount && refundAmount > 0) {
      await this.refundsService.createRefund(
        paymentIntentId,
        refundAmount / 100,
      );
    }
    await this.updateSubscriptionStatus(sub);
    const attachments = await this.getInvoiceAttachments(stripeSub);
    await this.sendCancelEmail(sub, stripeSub, attachments);
    return sub;
  }

  private async findSubscriptionForCancel(subscriptionId: string) {
    let sub = null;
    if (isUuid(subscriptionId)) {
      sub = await this.subscriptionRepository.findOne({
        where: { id: subscriptionId },
        relations: ['plan', 'pendingPlan'],
      });
      if (!sub) throw new NotFoundException('Subscription not found');
    } else {
      sub = await this.subscriptionRepository.findOne({
        where: { stripeSubscriptionId: subscriptionId },
        relations: ['plan', 'pendingPlan'],
      });
      if (!sub) throw new NotFoundException('Subscription not found');
    }
    return sub;
  }

  private async getStripeSubscription(stripeId: string) {
    return this.stripeService
      .getStripeInstance()
      .subscriptions.retrieve(stripeId, {
        expand: ['latest_invoice.payment_intent'],
      });
  }

  private async cancelScheduleIfNeeded(stripeSub: any, sub: any) {
    if (stripeSub.schedule) {
      try {
        await this.stripeService
          .getStripeInstance()
          .subscriptionSchedules.cancel(stripeSub.schedule);
      } catch (err: any) {
        if (
          !(
            err &&
            err.statusCode === 400 &&
            typeof err.message === 'string' &&
            err.message.includes('currently in the `canceled` status')
          )
        ) {
          throw err;
        }
      }
      sub.pendingPlanId = null;
      sub.pendingPlan = null;
    }
  }

  private calculateRefund(stripeSub: any) {
    const startUnix = stripeSub.current_period_start;
    const endUnix = stripeSub.current_period_end;
    const nowUnix = Math.floor(Date.now() / 1000);
    const daysTotal = Math.ceil((endUnix - startUnix) / 86400);
    const daysUsed = Math.ceil((nowUnix - startUnix) / 86400);
    const daysUnused = daysTotal - daysUsed;
    const latestInvoice = stripeSub.latest_invoice;
    let paymentIntentId: string | undefined = undefined;
    let amountPaid: number | undefined = undefined;
    if (typeof latestInvoice === 'object' && latestInvoice.payment_intent) {
      paymentIntentId =
        typeof latestInvoice.payment_intent === 'string'
          ? latestInvoice.payment_intent
          : latestInvoice.payment_intent.id;
      amountPaid = latestInvoice.amount_paid;
    }
    if (
      !paymentIntentId &&
      stripeSub.latest_invoice &&
      typeof stripeSub.latest_invoice === 'object'
    ) {
      const pi = stripeSub.latest_invoice.payment_intent;
      if (pi && typeof pi === 'object' && pi.id) {
        paymentIntentId = pi.id;
        amountPaid = pi.amount;
      }
    }
    let refundAmount: number | undefined = undefined;
    if (amountPaid) {
      if (daysUsed <= 3) {
        refundAmount = amountPaid;
      } else if (daysUnused > 0 && daysTotal > 0) {
        refundAmount = Math.round((amountPaid * daysUnused) / daysTotal);
      }
    }
    return { paymentIntentId, refundAmount };
  }

  private async updateSubscriptionStatus(sub: any) {
    sub.status = 'canceled';
    sub.canceledAt = new Date();
    await this.subscriptionRepository.save(sub);
  }

  private async sendCancelEmail(sub: any, stripeSub: any, attachments: any[]) {
    const customer = await this.stripeService
      .getStripeInstance()
      .customers.retrieve(sub.customerId);
    const email = (customer as any).email;
    if (email) {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Subscription Cancelled',
        text: `Your subscription to ${sub.plan?.name || 'your plan'} has been cancelled.`,
        html: `<p>Your subscription to <b>${sub.plan?.name || 'your plan'}</b> has been cancelled.</p>`,
        attachments,
      });
    }
  }

  /**
   * Get all refunds for a subscription.
   * @param subscriptionId Subscription ID or Stripe ID
   * @returns List of refunds
   */
  async getRefunds(subscriptionId: string) {
    let sub = null;
    if (isUuid(subscriptionId)) {
      sub = await this.subscriptionRepository.findOne({
        where: { id: subscriptionId },
      });
    }
    sub ??= await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (!sub) throw new NotFoundException('Subscription not found');

    const stripe = this.stripeService.getStripeInstance();
    const invoices = await stripe.invoices.list({
      subscription: sub.stripeSubscriptionId,
      limit: 100,
    });
    const refunds: any[] = [];
    for (const invoice of invoices.data) {
      const chargeId = (invoice as any).charge;
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId, {
          expand: ['refunds'],
        });
        if (charge.refunds && charge.refunds.data.length > 0) {
          for (const refund of charge.refunds.data) {
            refunds.push({
              ...refund,
              refunded:
                refund.status === 'succeeded' &&
                refund.amount === charge.amount,
              original_charge_amount: charge.amount,
            });
          }
        }
      }
    }
    return refunds;
  }

  /**
   * Get all refunds in the system.
   * @returns List of refunds
   */
  async getAllRefunds() {
    const stripe = this.stripeService.getStripeInstance();
    const refunds = await stripe.refunds.list({ limit: 100 });
    return refunds.data;
  }

  /**
   * Sync a Stripe subscription to the local database.
   * @param stripeSub Stripe subscription object
   */
  async syncFromStripe(stripeSub: any) {
    this.logStripeSync(stripeSub);
    const plan = await this.findPlanForStripeSub(stripeSub);
    if (!plan) return;
    let sub = await this.findSubscriptionForStripeSub(stripeSub);
    const currentPeriodEnd = this.getDateFromUnix(stripeSub.current_period_end);
    const canceledAt = this.getDateFromUnix(stripeSub.canceled_at);
    const updatePlan = this.shouldUpdatePlan(sub, currentPeriodEnd);
    const data = this.prepareSubscriptionData(
      stripeSub,
      plan,
      sub,
      updatePlan,
      currentPeriodEnd,
      canceledAt,
    );

    if (sub) {
      await this.subscriptionRepository.update(sub.id, data);
      if (this.shouldSendActiveEmail(stripeSub, sub)) {
        const attachments = await this.getInvoiceAttachments(stripeSub);
        await this.sendActiveEmail(stripeSub, attachments);
      }
    } else {
      const newSub = this.subscriptionRepository.create({
        stripeSubscriptionId: stripeSub.id,
        ...data,
      });
      await this.subscriptionRepository.save(newSub);
      if (stripeSub.status === 'active') {
        const attachments = await this.getInvoiceAttachments(stripeSub);
        await this.sendActiveEmail(stripeSub, attachments);
      }
    }
    this.logSubscriptionSaved();
  }

  private logStripeSync(stripeSub: any) {
    console.log(
      'syncFromStripe called with:',
      JSON.stringify(stripeSub, null, 2),
    );
    console.log('Stripe subscription status:', stripeSub.status);
    console.log(
      'Looking for plan with stripePriceId:',
      stripeSub.items.data[0].price.id,
    );
  }

  private async findPlanForStripeSub(stripeSub: any) {
    const priceId = stripeSub.items.data[0].price.id;
    const plan = await this.planRepository.findOne({
      where: { stripePriceId: priceId },
    });
    if (!plan) {
      console.log('Plan not found for stripePriceId:', priceId);
    } else {
      console.log('Found plan:', plan);
    }
    return plan;
  }

  private async findSubscriptionForStripeSub(stripeSub: any) {
    const sub = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
      relations: ['plan', 'pendingPlan'],
    });
    console.log('Existing subscription found:', sub ? 'yes' : 'no');
    return sub;
  }

  private getDateFromUnix(unix: number | undefined): Date | undefined {
    if (unix && typeof unix === 'number') {
      return new Date(unix * 1000);
    }
    return undefined;
  }

  private shouldUpdatePlan(
    sub: any,
    currentPeriodEnd: Date | undefined,
  ): boolean {
    if (sub?.currentPeriodEnd && currentPeriodEnd) {
      return currentPeriodEnd.getTime() > sub.currentPeriodEnd.getTime();
    }
    return true;
  }

  private prepareSubscriptionData(
    stripeSub: any,
    plan: any,
    sub: any,
    updatePlan: boolean,
    currentPeriodEnd: Date | undefined,
    canceledAt: Date | undefined,
  ) {
    const data: any = {
      customerId: stripeSub.customer,
      status: stripeSub.status,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end || false,
    };
    if (updatePlan) {
      data.plan = sub?.pendingPlan ? sub.pendingPlan : plan;
      data.pendingPlan = null;
    } else {
      data.pendingPlan = plan;
    }
    if (currentPeriodEnd) {
      data.currentPeriodEnd = currentPeriodEnd;
    }
    if (canceledAt) {
      data.canceledAt = canceledAt;
    }
    console.log('Data to save:', data);
    console.log(
      'Stripe subscription current_period_end:',
      stripeSub.current_period_end,
    );
    console.log('Stripe subscription canceled_at:', stripeSub.canceled_at);
    return data;
  }

  private shouldSendActiveEmail(stripeSub: any, sub: any): boolean {
    return (
      stripeSub.status === 'active' && (!sub.status || sub.status !== 'active')
    );
  }

  private async getInvoiceAttachments(stripeSub: any) {
    let attachments = [];
    if (stripeSub.latest_invoice) {
      const invoiceId =
        typeof stripeSub.latest_invoice === 'string'
          ? stripeSub.latest_invoice
          : stripeSub.latest_invoice.id;
      const invoice = await this.stripeService
        .getStripeInstance()
        .invoices.retrieve(invoiceId);
      if (invoice && (invoice as any).invoice_pdf) {
        try {
          const response = await axios.get((invoice as any).invoice_pdf, {
            responseType: 'arraybuffer',
          });
          attachments.push({
            filename: 'invoice.pdf',
            content: Buffer.from(response.data),
          });
        } catch (e) {
          console.error('Failed to fetch invoice PDF:', e);
        }
      }
    }
    return attachments;
  }

  private async sendActiveEmail(stripeSub: any, attachments: any[]) {
    const customer = await this.stripeService
      .getStripeInstance()
      .customers.retrieve(stripeSub.customer);
    const email = (customer as any).email;
    if (email) {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Subscription Created',
        text: `Your subscription has been created and is now active.`,
        html: `<p>Your subscription has been created and is now <b>active</b>.</p><p>Thank you!</p>`,
        attachments,
      });
    }
  }

  private logSubscriptionSaved() {
    console.log('Subscription saved successfully');
  }

  /**
   * Create a Stripe customer and attach a test payment method.
   * @param name Customer name
   * @param email Customer email
   * @returns Customer with default payment method ID
   */
  async createStripeCustomer(name: string, email: string) {
    const customer = await this.stripeService.createStripeCustomer(name, email);

    const paymentMethod = await this.stripeService
      .getStripeInstance()
      .paymentMethods.create({
        type: 'card',
        card: { token: 'tok_visa' },
        billing_details: { name, email },
      });

    await this.stripeService
      .getStripeInstance()
      .paymentMethods.attach(paymentMethod.id, {
        customer: customer.id,
      });

    await this.stripeService.getStripeInstance().customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    });

    return { ...customer, defaultPaymentMethodId: paymentMethod.id };
  }

  /**
   * Create a Stripe checkout session for a subscription.
   * @param customerId Stripe customer ID
   * @param priceId Stripe price ID
   * @returns Stripe checkout session
   */
  async createCheckoutSession(customerId: string, priceId: string) {
    return this.stripeService.createCheckoutSession(customerId, priceId);
  }

  /**
   * Get all subscriptions.
   * @returns List of subscriptions
   */
  async findAll() {
    return this.subscriptionRepository.find({
      relations: ['plan', 'pendingPlan'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get paginated subscriptions.
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated subscriptions
   */
  async findAllPaginated(page = 1, limit = 10) {
    const [data, total] = await this.subscriptionRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
      relations: ['plan', 'pendingPlan'],
    });
    const totalPages = Math.ceil(total / limit);
    return { total, page, limit, totalPages, data };
  }

  /**
   * Create a payment session subscription for Stripe Checkout.
   * @param customerId Stripe customer ID
   * @param priceId Stripe price ID
   * @returns Subscription info and client secret
   */
  async createPaymentSessionSubscription(customerId: string, priceId: string) {
    const existing = await this.subscriptionRepository.findOne({
      where: {
        customerId,
        status: Not('canceled'),
      },
    });
    if (existing && existing.status !== 'incomplete') {
      return { error: 'Customer already has an active subscription.' };
    }
    const expandArray = ['latest_invoice', 'latest_invoice.payment_intent'];
    console.log('Creating subscription with expand:', expandArray);
    const subscription = await this.stripeService
      .getStripeInstance()
      .subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        expand: expandArray,
      });
    console.log(
      'Full subscription object:',
      JSON.stringify(subscription, null, 2),
    );
    let clientSecret: string | undefined = undefined;
    if (
      subscription.latest_invoice &&
      typeof subscription.latest_invoice === 'object' &&
      'payment_intent' in subscription.latest_invoice
    ) {
      const paymentIntent = (subscription.latest_invoice as any).payment_intent;
      if (
        paymentIntent &&
        typeof paymentIntent === 'object' &&
        'client_secret' in paymentIntent
      ) {
        clientSecret = paymentIntent.client_secret;
      }
    }
    console.log('Extracted clientSecret:', clientSecret);
    return {
      subscriptionId: subscription.id,
      clientSecret,
      status: subscription.status,
    };
  }
}
