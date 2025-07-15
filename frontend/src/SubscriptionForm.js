import React, { useState, useEffect } from 'react';
import { useStripe, useElements, CardElement } from '@stripe/react-stripe-js';

const formStyle = {
  maxWidth: 400,
  margin: '40px auto',
  padding: 32,
  borderRadius: 16,
  background: '#fff',
  boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};
const inputStyle = {
  padding: '12px 14px',
  borderRadius: 8,
  border: '1px solid #ddd',
  fontSize: 16,
};
const buttonStyle = {
  padding: '12px 0',
  borderRadius: 8,
  border: 'none',
  background: 'linear-gradient(90deg, #6366f1 0%, #60a5fa 100%)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 18,
  cursor: 'pointer',
  marginTop: 8,
  transition: 'background 0.2s',
};
const buttonDisabledStyle = {
  ...buttonStyle,
  background: '#cbd5e1',
  cursor: 'not-allowed',
};
const messageStyle = {
  minHeight: 28,
  marginTop: 8,
  textAlign: 'center',
  fontWeight: 500,
};
const errorStyle = {
  ...messageStyle,
  color: '#dc2626',
  background: '#fee2e2',
  borderRadius: 6,
  padding: '6px 0',
};
const successStyle = {
  ...messageStyle,
  color: '#16a34a',
  background: '#dcfce7',
  borderRadius: 6,
  padding: '6px 0',
};
const spinnerStyle = {
  display: 'inline-block',
  width: 22,
  height: 22,
  border: '3px solid #60a5fa',
  borderTop: '3px solid #fff',
  borderRadius: '50%',
  animation: 'spin 1s linear infinite',
  margin: '0 auto',
};

export default function SubscriptionForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [priceId, setPriceId] = useState('');
  const [plans, setPlans] = useState([]);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState(''); // 'error' | 'success' | ''
  const [loading, setLoading] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const API_BASE = 'http://localhost:3000/subscriptions';
  const PLANS_API = 'http://localhost:3000/plans';

  useEffect(() => {
    let interval;
    async function fetchPlans() {
      try {
        const res = await fetch(PLANS_API);
        const result = await res.json();
        const plansArray = Array.isArray(result) ? result : result.data;
        setPlans(plansArray.filter(p => p.active));
        // If the current priceId is not in the new plans, reset to the first
        if (plansArray.length > 0 && !plansArray.some(p => p.stripePriceId === priceId)) {
          setPriceId(plansArray[0].stripePriceId);
        }
      } catch (err) {
        setPlans([]);
      }
    }
    fetchPlans();
    interval = setInterval(fetchPlans, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, [priceId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setMessageType('');

    if (!cardComplete) {
      setMessage('Please complete all card fields.');
      setMessageType('error');
      setLoading(false);
      return;
    }

    // 1. Call your backend to create a payment session for subscription
    let res, data;
    try {
      res = await fetch(`${API_BASE}/create-payment-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, priceId }),
      });
      data = await res.json();
    } catch (err) {
      setMessage('Network error. Please try again.');
      setMessageType('error');
      setLoading(false);
      return;
    }

    // If backend returns error (e.g., duplicate user/email)
    if (!res.ok || data.error || !data.clientSecret) {
      if (data && data.error && data.error.includes('already exists')) {
        setMessage('A user with this email already exists. Please use a different email.');
      } else {
        setMessage(data && data.error ? data.error : 'Failed to create payment session.');
      }
      setMessageType('error');
      setLoading(false);
      return;
    }

    // 2. Use Stripe.js to confirm the card payment
    const cardElement = elements.getElement(CardElement);
    const result = await stripe.confirmCardPayment(data.clientSecret, {
      payment_method: { card: cardElement, billing_details: { name, email } },
    });
    const { error, paymentIntent } = result;
    console.log('Stripe confirmCardPayment result:', result);

    if (error) {
      setMessage('Stripe error: ' + error.message);
      setMessageType('error');
    } else if (paymentIntent && paymentIntent.status === 'succeeded') {
      setMessage('Payment successful! Subscription active.');
      setMessageType('success');
    } else {
      setMessage('Payment status: ' + (paymentIntent?.status || 'unknown'));
      setMessageType('');
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} style={formStyle} autoComplete="off">
      <h2 style={{ textAlign: 'center', marginBottom: 8, color: '#2563eb' }}>Subscribe</h2>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Name"
        required
        style={inputStyle}
        autoComplete="off"
      />
      <input
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Email"
        required
        style={inputStyle}
        autoComplete="off"
        type="email"
      />
      <select
        value={priceId}
        onChange={e => setPriceId(e.target.value)}
        required
        style={{ ...inputStyle, paddingRight: 30 }}
      >
        {plans.length === 0 && <option value="">Loading plans...</option>}
        {plans.map(plan => (
          <option key={plan.stripePriceId} value={plan.stripePriceId}>
            {plan.name} - {plan.amount} {plan.currency.toUpperCase()} / {plan.interval}
          </option>
        ))}
      </select>
      <div style={{ padding: 10, border: '1px solid #ddd', borderRadius: 8, background: '#f9fafb' }}>
        <CardElement onChange={e => setCardComplete(e.complete)} options={{ style: { base: { fontSize: '16px' } } }} />
      </div>
      <button
        type="submit"
        disabled={!stripe || loading || !cardComplete}
        style={!stripe || loading || !cardComplete ? buttonDisabledStyle : buttonStyle}
      >
        {loading ? <span style={spinnerStyle} /> : 'Subscribe'}
      </button>
      {message && (
        <div style={messageType === 'error' ? errorStyle : messageType === 'success' ? successStyle : messageStyle}>
          {message}
        </div>
      )}
      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>
    </form>
  );
} 