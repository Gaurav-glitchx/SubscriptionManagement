import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import Stripe from 'stripe';
import { Request, Response } from 'express';
import { PlansService } from '../plans/plans.service';
import { LoggingService } from '../logging/logging.service';
import { RefundsService } from '../refunds/refunds.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class StripeService {
  private readonly stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2024-04-10' as any,
  });
  private readonly logger = new Logger(StripeService.name);

  constructor(
    private readonly plansService: PlansService,
    private readonly loggingService: LoggingService,
    private readonly refundsService: RefundsService,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * Handles Stripe webhook events from Stripe API.
   * @param req Express request
   * @param res Express response
   * @param sig Stripe signature
   */
  async handleWebhook(req: Request, res: Response, sig: string) {
    this.logger.debug('Received webhook request', {
      headers: req.headers,
      rawBody: req.body,
    });
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
    } catch (err) {
      this.logger.error('Webhook signature verification failed.', err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    this.logger.log(`Received Stripe event: ${event.type}`);
    this.logger.debug(
      'Event data:',
      JSON.stringify(event.data.object, null, 2),
    );
    await this.loggingService.logEvent(event.type, event.data.object);

    switch (event.type) {
      case 'product.created':
      case 'product.updated': {
        const product = event.data.object;
        const prices = await this.stripe.prices.list({
          product: product.id,
          limit: 100,
        });
        for (const price of prices.data) {
          await this.plansService.upsertFromStripe(product, price);
        }
        break;
      }
      case 'price.created':
      case 'price.updated': {
        const price = event.data.object;
        if (typeof price.product === 'string') {
          const product = await this.stripe.products.retrieve(price.product);
          await this.plansService.upsertFromStripe(product, price);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object;
        await this.subscriptionsService.syncFromStripe(stripeSub);
        break;
      }
      case 'charge.refunded':
      case 'refund.updated': {
        const refund = event.data.object as Stripe.Refund;
        await this.refundsService.syncRefundFromStripe(refund);
        break;
      }
      case 'checkout.session.completed': {
        const session = event.data.object;
        await this.handleCheckoutSessionCompleted(session);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = (invoice as any).subscription;
        if (subscriptionId) {
          const subscription =
            await this.stripe.subscriptions.retrieve(subscriptionId);
          await this.subscriptionsService.syncFromStripe(subscription);
        }
        break;
      }
      default:
        this.logger.warn(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  }

  /**
   * Create a new subscription in Stripe for a customer and plan.
   * @param customerId Stripe customer ID
   * @param priceId Stripe price ID
   * @returns Stripe subscription
   */
  async createStripeSubscription(customerId: string, priceId: string) {
    return this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      expand: ['latest_invoice.payment_intent'],
    });
  }

  /**
   * Update a Stripe subscription to a new plan.
   * @param stripeSubscriptionId Stripe subscription ID
   * @param newPriceId New Stripe price ID
   * @param immediate If true, change now; else, schedule
   * @returns Updated Stripe subscription
   */
  async updateStripeSubscription(
    stripeSubscriptionId: string,
    newPriceId: string,
    immediate: boolean,
  ) {
    const subscription =
      await this.stripe.subscriptions.retrieve(stripeSubscriptionId);
    const itemId = subscription.items.data[0].id;

    if (immediate) {
      return this.stripe.subscriptions.update(stripeSubscriptionId, {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: 'create_prorations',
        billing_cycle_anchor: 'unchanged',
        payment_behavior: 'pending_if_incomplete',
      });
    } else {
      return this.stripe.subscriptions.update(stripeSubscriptionId, {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: 'none',
      });
    }
  }

  /**
   * Cancel a Stripe subscription at period end.
   * @param stripeSubscriptionId Stripe subscription ID
   * @returns Updated Stripe subscription
   */
  async cancelStripeSubscription(stripeSubscriptionId: string) {
    return this.stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  /**
   * Create a refund in Stripe for a payment.
   * @param paymentIntentId Stripe payment intent ID
   * @param amount Amount to refund (optional)
   * @returns Stripe refund
   */
  async createStripeRefund(paymentIntentId: string, amount?: number) {
    return this.stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount ? Math.round(amount * 100) : undefined,
    });
  }

  /**
   * Create or get a Stripe customer by email.
   * @param name Customer name
   * @param email Customer email
   * @returns Stripe customer
   */
  async createStripeCustomer(name: string, email: string) {
    const existing = await this.stripe.customers.list({ email, limit: 1 });
    if (existing.data && existing.data.length > 0) {
      return existing.data[0];
    }
    return this.stripe.customers.create({ name, email });
  }

  /**
   * Create a Stripe checkout session for a subscription.
   * @param customerId Stripe customer ID
   * @param priceId Stripe price ID
   * @returns Stripe checkout session
   */
  async createCheckoutSession(customerId: string, priceId: string) {
    return this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_types: ['card'],
      success_url: 'http://localhost:3000/success',
      cancel_url: 'http://localhost:3000/cancel',
    });
  }

  /**
   * Create a backend subscription with payment method.
   * @param customerId Stripe customer ID
   * @param priceId Stripe price ID
   * @param paymentMethodId Stripe payment method ID
   * @returns Stripe subscription
   */
  async createBackendSubscription(
    customerId: string,
    priceId: string,
    paymentMethodId: string,
  ) {
    await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    await this.stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      expand: ['latest_invoice.payment_intent'],
    });

    return subscription;
  }

  /**
   * Create a payment intent in Stripe.
   * @param amount Amount in dollars
   * @param customerId Stripe customer ID (optional)
   * @returns Stripe payment intent
   */
  async createPaymentIntent(amount: number, customerId?: string) {
    return this.stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      customer: customerId,
      automatic_payment_methods: { enabled: true },
    });
  }

  /**
   * Get the Stripe instance used by this service.
   * @returns Stripe instance
   */
  getStripeInstance() {
    return this.stripe;
  }

  /**
   * Handle a completed Stripe checkout session.
   * @param session Stripe checkout session
   */
  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ) {
    this.logger.log(`Processing completed checkout session: ${session.id}`);
    console.log('Checkout session data:', JSON.stringify(session, null, 2));

    if (session.mode !== 'subscription') {
      this.logger.warn(
        `Skipping non-subscription checkout session: ${session.id}`,
      );
      return;
    }

    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        session.subscription as string,
        { expand: ['items.data.price.product'] },
      );

      console.log(
        'Retrieved subscription from Stripe:',
        JSON.stringify(subscription, null, 2),
      );

      await this.subscriptionsService.syncFromStripe(subscription);

      this.logger.log(
        `Successfully processed checkout session ${session.id} for subscription ${subscription.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing checkout session ${session.id}:`,
        error,
      );
      console.error('Error in handleCheckoutSessionCompleted:', error);
      throw error;
    }
  }
}
