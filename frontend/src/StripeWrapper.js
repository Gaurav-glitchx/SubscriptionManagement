import React from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe('pk_test_51RjgMrP0HsuWwpyIjQS3hzvMVL2YKb7YbJdkpBCA9DPf0TKAwbfUL9vsSNm4RSFqWadF8FL0xOJsztlROdmt1KXI003lmZOvSl'); // Replace with your Stripe publishable key

export default function StripeWrapper({ children }) {
  return <Elements stripe={stripePromise}>{children}</Elements>;
} 