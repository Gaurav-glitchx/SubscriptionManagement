import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './plan.entity';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
  ) {}

  /**
   * Add or update a plan from Stripe product and price.
   * @param product Stripe product object
   * @param price Stripe price object
   * @returns Plan
   */
  async upsertFromStripe(product: any, price: any) {
    const plan = await this.planRepository.findOne({
      where: { stripePriceId: price.id },
    });
    const data = {
      name: product.name,
      stripeProductId: product.id,
      stripePriceId: price.id,
      amount: price.unit_amount / 100,
      currency: price.currency,
      active: product.active && price.active,
      interval: price.recurring?.interval || null,
      description: product.description || null,
    };
    if (plan) {
      await this.planRepository.update(plan.id, data);
      return this.planRepository.findOne({ where: { id: plan.id } });
    } else {
      return this.planRepository.save(this.planRepository.create(data));
    }
  }

  /**
   * Get all plans from the database.
   * @returns List of plans
   */
  async getAllPlans() {
    return this.planRepository.find();
  }

  /**
   * Get paginated plans from the database.
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated plans
   */
  async findAllPaginated(page = 1, limit = 10) {
    const [data, total] = await this.planRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { name: 'ASC' },
    });
    const totalPages = Math.ceil(total / limit);
    return { total, page, limit, totalPages, data };
  }
}
