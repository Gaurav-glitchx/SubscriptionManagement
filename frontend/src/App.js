import React from 'react';
import StripeWrapper from './StripeWrapper';
import SubscriptionForm from './SubscriptionForm';

export default function App() {
  return (
    <StripeWrapper>
      <SubscriptionForm />
    </StripeWrapper>
  );
} 