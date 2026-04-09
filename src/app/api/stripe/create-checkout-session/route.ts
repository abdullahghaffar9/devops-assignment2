import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';

// Get base URL for the application
// In production on Vercel, this should be set to: https://inspired-analyst.vercel.app
const getBaseUrl = () => {
  // Check if NEXT_PUBLIC_BASE_URL is set (preferred method - always use this if set)
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, ''); // Remove trailing slash
  }
  
  // For production on Vercel, check VERCEL_ENV to distinguish production from preview
  if (process.env.VERCEL_ENV === 'production') {
    // Use the production domain directly
    return 'https://inspired-analyst.vercel.app';
  }
  
  // For preview/development on Vercel (if env var not set)
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  
  // Fallback for local development
  return 'http://localhost:3000';
};

// Environment-based pricing configuration
const isTestMode = process.env.NODE_ENV === 'development' || process.env.STRIPE_TEST_MODE === 'true';

// Meeting types configuration - matches your existing data
const meetingTypes = [
  {
    id: 'initial-consultation',
    name: 'Initial Consultation',
    duration: 30,
    price: 10, // $10 for all meeting types
    description: 'Quick overview and needs assessment'
  },
  {
    id: 'initial-consultation-1',
    name: 'Extended Initial Consultation',
    duration: 45,
    price: 10, // $10 for all meeting types
    description: 'Extended consultation with detailed analysis'
  },
  {
    id: 'strategy-workshop',
    name: 'Strategy Workshop',
    duration: 90,
    price: 10, // $10 for all meeting types
    description: 'Intensive planning and implementation workshop'
  },
  {
    id: 'follow-up-session',
    name: 'Follow-up Session',
    duration: 45,
    price: 10, // $10 for all meeting types
    description: 'Progress review and next steps'
  }
];

export async function POST(request: NextRequest) {
  try {
    console.log(`💰 Pricing Mode: ${isTestMode ? 'TEST ($1 charges)' : 'PRODUCTION (real prices)'}`);
    const body = await request.json();
    console.log('Stripe checkout request body:', JSON.stringify(body, null, 2));

    // Simple validation
    if (!body.type || !body.customerEmail) {
      console.error('Missing required fields:', { type: body.type, customerEmail: body.customerEmail });
      return NextResponse.json(
        { error: 'Missing required fields', missing: { type: !body.type, customerEmail: !body.customerEmail } },
        { status: 400 }
      );
    }

    if (body.type !== 'booking') {
      return NextResponse.json(
        { error: 'Invalid type. Must be "booking"' },
        { status: 400 }
      );
    }

    let productDetails;
    let amount;

    {
      const meetingType = meetingTypes.find(mt => mt.id === body.meetingTypeId);
      if (!meetingType) {
        return NextResponse.json(
          { error: 'Invalid meeting type' },
          { status: 400 }
        );
      }
      
      // Use price from frontend if provided, otherwise fall back to meeting type default
      let priceValue: number;
      if (body.priceAmount && typeof body.priceAmount === 'number' && body.priceAmount > 0) {
        priceValue = body.priceAmount;
        console.log(`Using frontend price: $${priceValue}`);
      } else {
        priceValue = meetingType.price;
        console.log(`Using default meeting type price: $${priceValue}`);
      }
      
      productDetails = {
        name: meetingType.name,
        description: meetingType.description,
        price: priceValue
      };
      amount = priceValue * 100; // Convert to cents
    }

    // Validate amount before creating Stripe session
    if (!amount || amount <= 0) {
      console.error('Invalid amount for Stripe session:', amount);
      return NextResponse.json(
        { 
          error: 'Invalid price',
          details: `Amount must be greater than 0, got: ${amount}`
        },
        { status: 400 }
      );
    }

    console.log('Creating Stripe checkout session with:', {
      productName: productDetails.name,
      amount: amount,
      currency: 'usd',
      customerEmail: body.customerEmail,
      type: body.type
    });

    // Create Stripe checkout session
    let session;
    try {
      session = await getStripe().checkout.sessions.create({
        mode: 'payment',
        currency: 'usd',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: productDetails.name,
                description: productDetails.description || undefined,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        customer_email: body.customerEmail,
        metadata: {
          type: body.type,
          customerEmail: body.customerEmail,
          customerName: body.customerName || '',
          meetingTypeId: body.meetingTypeId
        },
        success_url: `${getBaseUrl()}/meetings?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${getBaseUrl()}/meetings?payment=cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // 30 minutes from now
      });
      
      console.log('Stripe session created successfully:', session.id);
    } catch (stripeError: any) {
      console.error('Stripe API error:', {
        message: stripeError.message,
        type: stripeError.type,
        code: stripeError.code,
        param: stripeError.param,
        raw: stripeError
      });
      return NextResponse.json(
        { 
          error: 'Failed to create Stripe checkout session',
          details: stripeError.message || 'Unknown Stripe error',
          stripeError: stripeError.type || 'unknown'
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      url: session.url,
      amount: amount,
      currency: 'USD',
      productName: productDetails.name,
      expiresAt: new Date(session.expires_at! * 1000).toISOString()
    });

  } catch (error) {
    console.error('Stripe checkout session creation error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to create checkout session',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
