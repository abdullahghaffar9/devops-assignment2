import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;

/** Lazy init so `next build` can load routes without Stripe env vars. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is required');
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key, {
      apiVersion: '2024-12-18.acacia',
      typescript: true,
    });
  }
  return stripeSingleton;
}

// Stripe configuration for checkout sessions
export const STRIPE_CONFIG = {
  currency: 'usd',
  mode: 'payment' as const,
  successUrl: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/meetings?payment=cancelled`,
};

// Helper function to verify webhook signature
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  
  try {
    return getStripe().webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    throw new Error('Invalid webhook signature');
  }
}

// Types for our application
export interface BookingSessionData {
  type: 'booking';
  meetingTypeId: string;
  customerEmail: string;
  customerName?: string;
  amount: number; // in cents
  meetingName: string;
  meetingDescription: string;
}
