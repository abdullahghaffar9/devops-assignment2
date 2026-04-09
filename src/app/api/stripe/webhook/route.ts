import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getStripe, verifyWebhookSignature } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    // Get the raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      console.error('Missing Stripe signature header');
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 400 }
      );
    }

    // Verify webhook signature
    let event;
    try {
      event = verifyWebhookSignature(body, signature);
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      );
    }

    console.log(`✅ Received webhook event: ${event.type}`);

    // Process webhook asynchronously (don't wait for DB operations)
    // This prevents timeouts while still processing the webhook
    setImmediate(() => {
      processWebhookAsync(event).catch(error => {
        console.error('Async webhook processing error:', error);
      });
    });

    // Immediately return success to prevent timeout
    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

// Helper function to get subscription ID from invoice
async function getSubscriptionFromInvoice(invoiceIdOrObject: string | any): Promise<string | null> {
  try {
    const invoice = typeof invoiceIdOrObject === 'string'
      ? await getStripe().invoices.retrieve(invoiceIdOrObject)
      : invoiceIdOrObject;
    return invoice.subscription as string | null;
  } catch (error) {
    console.error('Error getting subscription from invoice:', error);
    return null;
  }
}

async function processWebhookAsync(event: any) {
  console.log(`Processing webhook: ${event.type}`);
  const db = await getDb();

  try {

    // Handle subscription events
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log(`✅ Payment completed for session: ${session.id}`);
      
      // Extract metadata
      const metadata = session.metadata || {};
      const type = metadata.type || (session.mode === 'subscription' ? 'subscription' : null);
      
      if (!type) {
        console.log('⚠️ No type in metadata, skipping database save');
        return;
      }

      try {
        if (type === 'subscription' || session.mode === 'subscription') {
          // Handle subscription checkout completion
          const subscriptionId = session.subscription;
          if (subscriptionId) {
            const stripeSubscription = await getStripe().subscriptions.retrieve(subscriptionId);
            
            // Get user ID from metadata or find by email
            let userId: string | null = metadata.userId || null;
            if (!userId && metadata.customerEmail) {
              const user = await db.collection('public_users').findOne({ email: metadata.customerEmail });
              if (user) userId = String((user as Record<string, unknown>)._id ?? (user as Record<string, unknown>).id);
            }

            if (!userId) {
              console.log('⚠️ Could not find user for subscription');
              return;
            }

            const existingSubscription = await db.collection('subscriptions').findOne({ stripeSubscriptionId: subscriptionId });

            if (existingSubscription) {
              console.log(`ℹ️ Subscription already exists for ${subscriptionId}`);
              return;
            }

            // Fetch plan from database
            const priceItem = stripeSubscription.items.data[0]?.price;
            
            // Try to find plan by Stripe price ID first
            let planData = await db.collection('plans').findOne({ stripePriceId: priceItem?.id || '' });
            
            if (!planData) {
              // Fallback to matching by interval and amount
              const interval = priceItem?.recurring?.interval;
              const intervalCount = priceItem?.recurring?.interval_count || 1;
              const amount = priceItem?.unit_amount ? priceItem.unit_amount / 100 : 0;
              
              if (interval === 'year' && amount === 100) {
                planData = await db.collection('plans').findOne({ planId: 'annual' });
              } else if (interval === 'month' && intervalCount === 6 && amount === 60) {
                planData = await db.collection('plans').findOne({ planId: 'platinum' });
              } else if (interval === 'month' && intervalCount === 1 && amount === 30) {
                planData = await db.collection('plans').findOne({ planId: 'monthly' });
              }
            }

            let planType: string;
            let planName: string;
            let price: string;

            if (planData) {
              planType = planData.planId;
              planName = planData.name;
              price = planData.isFree ? 'FREE' : planData.priceDisplay;
            } else {
              // Fallback to hardcoded values
              const interval = priceItem?.recurring?.interval;
              const intervalCount = priceItem?.recurring?.interval_count || 1;
              
              if (interval === 'year') {
                planType = 'annual';
                planName = 'Diamond';
                price = '$100 USD';
              } else if (interval === 'month' && intervalCount === 6) {
                planType = 'platinum';
                planName = 'Platinum';
                price = '$60 USD';
              } else {
                planType = 'monthly';
                planName = 'Premium';
                price = '$30 USD';
              }
            }

            // Create subscription record
            const stripeCustomerId = typeof stripeSubscription.customer === 'string' 
              ? stripeSubscription.customer 
              : stripeSubscription.customer.id;

            const subId = crypto.randomUUID();
            await db.collection('subscriptions').insertOne({
              _id: subId,
              id: subId,
              userId,
              stripeSubscriptionId: subscriptionId,
              stripeCustomerId: stripeCustomerId,
              planName,
              planType,
              planId: (planData as Record<string, unknown>)?.planId || null,
              price,
              status: stripeSubscription.status,
              currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
              currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
              cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            console.log(`✅ Subscription created for user ${userId}`);

            await db.collection('public_users').updateOne(
              { $or: [{ _id: userId }, { id: userId }] },
              {
                $set: {
                  isPaid: true,
                  subscriptionStatus: stripeSubscription.status ?? 'active',
                  lastPaymentAt: new Date(),
                  updatedAt: new Date(),
                },
              }
            );
            console.log(`✅ Updated user ${userId} to paid status`);

            // Save payment method from subscription
            try {
              const paymentMethodId = stripeSubscription.default_payment_method;
              if (paymentMethodId) {
                const stripePaymentMethod = await getStripe().paymentMethods.retrieve(paymentMethodId);
                
                const stripeCustomerId = typeof stripeSubscription.customer === 'string' 
                  ? stripeSubscription.customer 
                  : stripeSubscription.customer.id;

                // Remove existing default payment method for this user
                await db.collection('payment_methods').updateMany(
                  { userId, isDefault: true },
                  { $set: { isDefault: false } }
                );

                const pmId = crypto.randomUUID();
                await db.collection('payment_methods').insertOne({
                  _id: pmId,
                  id: pmId,
                  userId,
                  stripePaymentMethodId: paymentMethodId,
                  stripeCustomerId: stripeCustomerId,
                  type: stripePaymentMethod.type || 'card',
                  last4: stripePaymentMethod.card?.last4 || null,
                  brand: stripePaymentMethod.card?.brand || null,
                  expMonth: stripePaymentMethod.card?.exp_month || null,
                  expYear: stripePaymentMethod.card?.exp_year || null,
                  isDefault: true,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });
                console.log(`✅ Payment method saved for user ${userId}`);
              }
            } catch (pmError) {
              console.error('Error saving payment method:', pmError);
              // Continue even if payment method save fails
            }

            // Create initial billing record for the subscription creation
            // Try to get the actual invoice from Stripe
            try {
              // Get the latest invoice for this subscription
              const invoices = await getStripe().invoices.list({
                subscription: subscriptionId,
                limit: 1,
              });

              let invoiceId = `INV-${Date.now()}`;
              let amount = planType === 'annual' ? 120 : 30;
              let currency = 'usd';
              let invoiceUrl = null;
              let paidAt = new Date();

              if (invoices.data.length > 0) {
                const latestInvoice = invoices.data[0];
                invoiceId = latestInvoice.id;
                amount = latestInvoice.amount_paid / 100;
                currency = latestInvoice.currency || 'usd';
                invoiceUrl = latestInvoice.hosted_invoice_url || null;
                paidAt = new Date(latestInvoice.created * 1000);
              }

              // Check if billing record already exists
              const existingBilling = await db.collection('billing_history').findOne({ stripeInvoiceId: invoiceId });

              if (!existingBilling) {
                const bhId = crypto.randomUUID();
                await db.collection('billing_history').insertOne({
                  _id: bhId,
                  id: bhId,
                  userId,
                  subscriptionId,
                  stripeInvoiceId: invoiceId,
                  amount,
                  currency,
                  status: 'paid',
                  invoiceDate: paidAt,
                  paidAt,
                  description: `Subscription payment for ${planName}`,
                  createdAt: new Date(),
                });
                console.log(`✅ Initial billing record created for subscription ${subscriptionId}`);
              } else {
                console.log(`ℹ️ Billing record already exists for invoice ${invoiceId}`);
              }
            } catch (billingError) {
              console.error('Error creating billing record:', billingError);
              // Continue even if billing record creation fails
            }
          }
        } else if (type === 'bootcamp') {
          console.log('🎓 [WEBHOOK] Processing bootcamp payment...', {
            sessionId: session.id,
            customerEmail: metadata.customerEmail,
            bootcampId: metadata.bootcampId,
            customerName: metadata.customerName,
            userIdInMetadata: metadata.userId
          });

          // Check if this session already exists to prevent duplicates
          const existingRegistration = await db.collection('bootcamp_registrations').findOne({ stripeSessionId: session.id });

          if (existingRegistration) {
            console.log(`ℹ️ Registration already exists for session ${session.id}, skipping duplicate`);
            return;
          }

          // Get user ID from metadata or find by email
          let userId: string | null = null;
          console.log('🔍 [WEBHOOK] Looking for user account...', {
            userIdInMetadata: metadata.userId,
            customerEmail: metadata.customerEmail
          });

          if (metadata.userId) {
            userId = metadata.userId;
            console.log(`📝 [WEBHOOK] Found userId in metadata: ${userId}`);
          }

          if (!userId && metadata.customerEmail) {
            console.log(`🔍 [WEBHOOK] Looking up user by email: ${metadata.customerEmail}`);
            const user = await db.collection('public_users').findOne({ 
              email: { $in: [metadata.customerEmail.toLowerCase().trim(), metadata.customerEmail.trim()] }
            });
            if (user) {
              userId = String((user as Record<string, unknown>)._id ?? (user as Record<string, unknown>).id ?? '');
              console.log(`✅ [WEBHOOK] Found user by email: ${userId}`);
            } else {
              console.log(`ℹ️ [WEBHOOK] No user found with email: ${metadata.customerEmail}`);
            }
          }

          console.log('👤 [WEBHOOK] User lookup result:', {
            userId: userId ? userId.toString() : null,
            willRequireSignup: !userId
          });

          // Validate bootcampId exists
          if (!metadata.bootcampId) {
            console.error('❌ Missing bootcampId in metadata', { metadata, sessionId: session.id });
            return;
          }

          // Get bootcamp details for email
          const bootcamp = await db.collection('bootcamps').findOne({
            bootcampId: metadata.bootcampId,
            isActive: true,
          });

          const bootcampTitle = bootcamp?.title || metadata.bootcampId;

          // If user doesn't exist, still create registration but send signup email
          if (!userId) {
            console.log('ℹ️ [WEBHOOK] No user account found for bootcamp purchase - will require signup', {
              customerEmail: metadata.customerEmail,
              bootcampId: metadata.bootcampId,
              sessionId: session.id,
              bootcampTitle: bootcampTitle
            });

            // Create bootcamp registration record with userId: null
            // This will be linked to the user when they sign up with the same email
            const regId = crypto.randomUUID();
            await db.collection('bootcamp_registrations').insertOne({
              id: regId,
              userId: null,
              stripeSessionId: session.id,
              bootcampId: metadata.bootcampId,
              customerName: metadata.customerName || '',
              customerEmail: metadata.customerEmail || '',
              notes: metadata.notes || '',
              status: 'confirmed',
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            const registration = { id: regId };
            console.log(`✅ Bootcamp registration saved (pending signup):`, {
              registrationId: registration.id,
              bootcampId: metadata.bootcampId,
              customerEmail: metadata.customerEmail,
              sessionId: session.id
            });

            // Send email to customer asking them to sign up
            console.log('📧 [WEBHOOK] Attempting to send bootcamp signup required email...', {
              customerEmail: metadata.customerEmail,
              customerName: metadata.customerName || '',
              bootcampTitle: bootcampTitle,
              bootcampId: metadata.bootcampId
            });
            
            try {
              const { sendBootcampSignupRequiredEmail } = await import('@/lib/email');
              console.log('📧 [WEBHOOK] Email function imported, calling sendBootcampSignupRequiredEmail...');
              
              await sendBootcampSignupRequiredEmail(
                metadata.customerEmail,
                metadata.customerName || '',
                bootcampTitle,
                metadata.bootcampId
              );
              
              console.log(`✅ [WEBHOOK] Signup required email sent successfully to ${metadata.customerEmail}`, {
                email: metadata.customerEmail,
                bootcampTitle: bootcampTitle,
                bootcampId: metadata.bootcampId
              });
            } catch (emailError: any) {
              console.error('❌ [WEBHOOK] Failed to send signup required email:', {
                error: emailError?.message || emailError,
                stack: emailError?.stack,
                customerEmail: metadata.customerEmail,
                bootcampTitle: bootcampTitle,
                bootcampId: metadata.bootcampId,
                errorDetails: emailError
              });
              // Don't fail the webhook if email fails - registration is still saved
            }

            return;
          }

          // User exists - create registration normally
          const regId = crypto.randomUUID();
          await db.collection('bootcamp_registrations').insertOne({
            id: regId,
            userId,
            stripeSessionId: session.id,
            bootcampId: metadata.bootcampId,
            customerName: metadata.customerName || '',
            customerEmail: metadata.customerEmail || '',
            notes: metadata.notes || '',
            status: 'confirmed',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          const registration = { id: regId };
          console.log(`✅ Bootcamp registration saved successfully:`, {
            registrationId: registration.id,
            userId: userId,
            bootcampId: metadata.bootcampId,
            customerEmail: metadata.customerEmail,
            sessionId: session.id
          });

          // Verify the registration was saved
          const verifyRegistration = await db.collection('bootcamp_registrations').findOne({ id: registration.id });
          if (!verifyRegistration) {
            console.error('❌ Registration verification failed - registration not found after insert');
          } else {
            console.log('✅ Registration verified in database');
          }

          // Send enrollment confirmation email to existing user
          try {
            const { sendBootcampEnrollmentEmail } = await import('@/lib/email');
            console.log('📧 [WEBHOOK] Attempting to send bootcamp enrollment email...', {
              customerEmail: metadata.customerEmail,
              customerName: metadata.customerName || '',
              bootcampTitle: bootcampTitle,
              bootcampId: metadata.bootcampId
            });
            
            await sendBootcampEnrollmentEmail(
              metadata.customerEmail || '',
              metadata.customerName || '',
              bootcampTitle,
              metadata.bootcampId,
              bootcamp?.description
            );
            
            console.log(`✅ [WEBHOOK] Enrollment email sent successfully to ${metadata.customerEmail}`, {
              email: metadata.customerEmail,
              bootcampTitle: bootcampTitle,
              bootcampId: metadata.bootcampId
            });
          } catch (emailError: any) {
            console.error('❌ [WEBHOOK] Failed to send enrollment email:', {
              error: emailError?.message || emailError,
              stack: emailError?.stack,
              customerEmail: metadata.customerEmail,
              bootcampTitle: bootcampTitle,
              bootcampId: metadata.bootcampId
            });
            // Don't fail the webhook if email fails - registration is still saved
          }
          
        } else if (type === 'booking') {
          // Check if this session already exists to prevent duplicates
          const existingBooking = await db.collection('bookings').findOne({ stripeSessionId: session.id });

          if (existingBooking) {
            console.log(`ℹ️ Booking already exists for session ${session.id}, skipping duplicate`);
            return;
          }

          // Create booking record
          const bookingId = crypto.randomUUID();
          await db.collection('bookings').insertOne({
            id: bookingId,
            stripeSessionId: session.id,
            clientName: metadata.customerName || '',
            clientEmail: metadata.customerEmail || '',
            service: metadata.meetingTypeId || 'consultation',
            date: new Date(),
            time: new Date().toTimeString().split(' ')[0],
            status: 'confirmed',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          console.log(`✅ Booking saved for ${metadata.customerEmail}`);
        }
      } catch (dbError) {
        console.error('Database error in webhook:', dbError);
      }
    } else if (event.type === 'customer.subscription.created') {
      // Handle subscription creation - create subscription record early
      const subscription = event.data.object;
      console.log(`✅ Subscription created: ${subscription.id}`);

      try {
        const metadata = subscription.metadata || {};
        
        // Get user ID from metadata or find by customer email
        let userId: string | null = metadata.userId || null;
        
        if (!userId) {
          // Try to find customer and get email
          let customerEmail = metadata.customerEmail;
          
          if (!customerEmail && subscription.customer) {
            try {
              const customer = typeof subscription.customer === 'string'
                ? await getStripe().customers.retrieve(subscription.customer)
                : subscription.customer;
              customerEmail = customer.email || null;
            } catch (error) {
              console.error('Error retrieving customer:', error);
            }
          }

          if (customerEmail) {
            const user = await db.collection('public_users').findOne({ email: customerEmail.toLowerCase().trim() });
            if (user) {
              userId = String((user as Record<string, unknown>)._id ?? (user as Record<string, unknown>).id ?? '');
              console.log(`✅ Found user by email: ${userId}`);
            }
          }
        }

        if (!userId) {
          console.log('⚠️ Could not find user for subscription creation, will retry on invoice.payment_succeeded');
          return;
        }

        // Check if subscription already exists
        const existingSubscription = await db.collection('subscriptions').findOne({ stripeSubscriptionId: subscription.id });

        if (existingSubscription) {
          console.log(`ℹ️ Subscription already exists for ${subscription.id}`);
          return;
        }

        // Determine plan type from subscription items
        const priceItem = subscription.items.data[0]?.price;
        const interval = priceItem?.recurring?.interval;
        const intervalCount = priceItem?.recurring?.interval_count || 1;
        const amount = priceItem?.unit_amount ? priceItem.unit_amount / 100 : 0;

        // Fetch plan from database
        // Try to find plan by Stripe price ID first
        let planData = await db.collection('plans').findOne({ stripePriceId: priceItem?.id || '' });
        
        if (!planData) {
          // Fallback to matching by interval and amount
          const intervalCount = priceItem?.recurring?.interval_count || 1;
          const amount = priceItem?.unit_amount ? priceItem.unit_amount / 100 : 0;
          
          if (interval === 'year' && amount === 100) {
            planData = await db.collection('plans').findOne({ planId: 'annual' });
          } else if (interval === 'month' && intervalCount === 6 && amount === 60) {
            planData = await db.collection('plans').findOne({ planId: 'platinum' });
          } else if (interval === 'month' && intervalCount === 1 && amount === 30) {
            planData = await db.collection('plans').findOne({ planId: 'monthly' });
          }
        }

        let planType: string;
        let planName: string;
        let price: string;

        if (planData) {
          planType = planData.planId;
          planName = planData.name;
          price = planData.isFree ? 'FREE' : planData.priceDisplay;
        } else {
          // Fallback to hardcoded values
          if (interval === 'year') {
            planType = 'annual';
            planName = 'Diamond';
            price = '$100 USD';
          } else if (interval === 'month' && intervalCount === 6) {
            planType = 'platinum';
            planName = 'Platinum';
            price = '$60 USD';
          } else {
            planType = 'monthly';
            planName = 'Premium';
            price = '$30 USD';
          }
        }

        // Create subscription record
        const stripeCustomerId = typeof subscription.customer === 'string' 
          ? subscription.customer 
          : subscription.customer.id;

        const subId = crypto.randomUUID();
        await db.collection('subscriptions').insertOne({
          id: subId,
          userId,
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: stripeCustomerId,
          planName,
          planType,
          planId: planData?.planId || null,
          price,
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(`✅ Subscription record created for user ${userId}`);
      } catch (error) {
        console.error('Error processing customer.subscription.created:', error);
      }
    } else if (event.type === 'customer.subscription.updated') {
      // Handle subscription updates (status changes, plan changes, etc.)
      const subscription = event.data.object;
      console.log(`✅ Subscription updated: ${subscription.id}`);

      await db.collection('subscriptions').updateOne(
        { stripeSubscriptionId: subscription.id },
        {
          $set: {
            status: subscription.status,
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            updatedAt: new Date(),
          },
        }
      );

      const updatedSubscription = await db.collection('subscriptions').findOne({ stripeSubscriptionId: subscription.id });

      if (updatedSubscription?.userId) {
        const userId = updatedSubscription.userId;

        const isSubscriptionActive = ['active', 'trialing', 'past_due'].includes(subscription.status);

        const userUpdate: Record<string, unknown> = {
          isPaid: isSubscriptionActive,
          subscriptionStatus: subscription.status ?? 'canceled',
        };

        if (isSubscriptionActive) {
          userUpdate.lastPaymentAt = new Date();
        }

        await db.collection('public_users').updateOne(
          { $or: [{ _id: userId }, { id: userId }] },
          { $set: { ...userUpdate, updatedAt: new Date() } }
        );
        console.log(`✅ Synced user ${userId} subscription status to ${subscription.status}`);
      }
    } else if (event.type === 'customer.subscription.deleted') {
      // Handle subscription cancellation and keep user account for free access
      const subscription = event.data.object;
      console.log(`✅ Subscription canceled: ${subscription.id}`);

      const dbSubscription = await db.collection('subscriptions').findOne({ stripeSubscriptionId: subscription.id });

      if (dbSubscription?.userId) {
        const userId = dbSubscription.userId;

        await db.collection('subscriptions').updateMany(
          { userId },
          { $set: { status: 'canceled', cancelAtPeriodEnd: false, updatedAt: new Date() } }
        );

        await db.collection('public_users').updateOne(
          { $or: [{ _id: userId }, { id: userId }] },
          { $set: { isPaid: false, subscriptionStatus: 'canceled', updatedAt: new Date() } }
        );

        console.log(`✅ Updated user ${userId} to unpaid status after cancellation`);
      } else {
        await db.collection('subscriptions').updateOne(
          { stripeSubscriptionId: subscription.id },
          { $set: { status: 'canceled', updatedAt: new Date() } }
        );
      }
    } else if (event.type === 'invoice.payment_succeeded') {
      // Handle successful subscription payments (initial + renewals)
      const invoice = event.data.object;
      
      if (invoice.subscription) {
        console.log(`✅ Invoice payment succeeded for subscription: ${invoice.subscription}`);

        // Get subscription to find userId
        let subscription = await db.collection('subscriptions').findOne({ stripeSubscriptionId: invoice.subscription });

        let userId: string | null = null;

        // If subscription doesn't exist in database yet, create it
        if (!subscription) {
          console.log(`⚠️ Subscription not found in database, creating it from invoice...`);
          
          try {
            // Retrieve subscription from Stripe
            const stripeSubscription = await getStripe().subscriptions.retrieve(invoice.subscription);
            const metadata = stripeSubscription.metadata || {};
            
            // Get user ID from metadata or find by customer email
            userId = metadata.userId || null;
            
            if (!userId) {
              // Try to get customer email
              let customerEmail = metadata.customerEmail;
              
              if (!customerEmail && invoice.customer_email) {
                customerEmail = invoice.customer_email;
              } else if (!customerEmail && stripeSubscription.customer) {
                try {
                  const customer = typeof stripeSubscription.customer === 'string'
                    ? await getStripe().customers.retrieve(stripeSubscription.customer)
                    : stripeSubscription.customer;
                  customerEmail = customer.email || null;
                } catch (error) {
                  console.error('Error retrieving customer:', error);
                }
              }

              if (customerEmail) {
                const user = await db.collection('public_users').findOne({ email: customerEmail.toLowerCase().trim() });
                if (user) {
                  userId = String((user as Record<string, unknown>)._id ?? (user as Record<string, unknown>).id ?? '');
                  console.log(`✅ Found user by email: ${userId}`);
                }
              }
            }

            if (userId) {
            // Fetch plan from database
            const priceItem = stripeSubscription.items.data[0]?.price;
            
            // Try to find plan by Stripe price ID first
            let planData = await db.collection('plans').findOne({ stripePriceId: priceItem?.id || '' });
            
            if (!planData) {
              // Fallback to matching by interval and amount
              const interval = priceItem?.recurring?.interval;
              const intervalCount = priceItem?.recurring?.interval_count || 1;
              const amount = priceItem?.unit_amount ? priceItem.unit_amount / 100 : 0;
              
              if (interval === 'year' && amount === 100) {
                planData = await db.collection('plans').findOne({ planId: 'annual' });
              } else if (interval === 'month' && intervalCount === 6 && amount === 60) {
                planData = await db.collection('plans').findOne({ planId: 'platinum' });
              } else if (interval === 'month' && intervalCount === 1 && amount === 30) {
                planData = await db.collection('plans').findOne({ planId: 'monthly' });
              }
            }

            let planType: string;
            let planName: string;
            let price: string;

            if (planData) {
              planType = planData.planId;
              planName = planData.name;
              price = planData.isFree ? 'FREE' : planData.priceDisplay;
            } else {
              // Fallback to hardcoded values
              const interval = priceItem?.recurring?.interval;
              const intervalCount = priceItem?.recurring?.interval_count || 1;
              
              if (interval === 'year') {
                planType = 'annual';
                planName = 'Diamond';
                price = '$100 USD';
              } else if (interval === 'month' && intervalCount === 6) {
                planType = 'platinum';
                planName = 'Platinum';
                price = '$60 USD';
              } else {
                planType = 'monthly';
                planName = 'Premium';
                price = '$30 USD';
              }
            }

              // Create subscription record
              const stripeCustomerId = typeof stripeSubscription.customer === 'string' 
                ? stripeSubscription.customer 
                : stripeSubscription.customer.id;

              const subId = crypto.randomUUID();
              await db.collection('subscriptions').insertOne({
                id: subId,
                userId,
                stripeSubscriptionId: stripeSubscription.id,
                stripeCustomerId: stripeCustomerId,
                planName,
                planType,
                planId: planData?.planId || null,
                price,
                status: stripeSubscription.status,
                currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
                currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
                cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
              subscription = { id: subId, userId, stripeSubscriptionId: stripeSubscription.id, status: stripeSubscription.status };
              console.log(`✅ Subscription record created from invoice for user ${userId}`);
            } else {
              console.log('⚠️ Could not find user for subscription, skipping billing history');
              return;
            }
          } catch (error) {
            console.error('Error creating subscription from invoice:', error);
            return;
          }
        } else {
          userId = subscription.userId;
        }

        // Check if billing record already exists (idempotency)
        const existingBilling = await db.collection('billing_history').findOne({ stripeInvoiceId: invoice.id });

        if (existingBilling) {
          console.log(`ℹ️ Billing record already exists for invoice ${invoice.id}`);
        } else {
          const bhId = crypto.randomUUID();
          await db.collection('billing_history').insertOne({
            id: bhId,
            userId,
            subscriptionId: invoice.subscription,
            stripeInvoiceId: invoice.id,
            amount: invoice.amount_paid / 100,
            currency: invoice.currency || 'usd',
            status: 'paid',
            invoiceDate: new Date(invoice.created * 1000),
            paidAt: new Date(invoice.created * 1000),
            description: `Invoice payment for subscription ${invoice.subscription}`,
            createdAt: new Date(),
          });
          console.log(`✅ Billing record created for subscription ${invoice.subscription}`);
        }

        // Update user payment status
        await db.collection('public_users').updateOne(
          { $or: [{ _id: userId }, { id: userId }] },
          {
            $set: {
              isPaid: true,
              subscriptionStatus: (subscription as Record<string, unknown>)?.status ?? 'active',
              lastPaymentAt: new Date(),
              updatedAt: new Date(),
            },
          }
        );
        console.log(`✅ Updated user ${userId} payment timestamp from invoice`);
      }
    } else if (event.type === 'payment_intent.succeeded') {
      // Fallback handler for payment success (in case invoice.payment_succeeded doesn't fire)
      const paymentIntent = event.data.object;
      console.log(`✅ Payment intent succeeded: ${paymentIntent.id}`);

      try {
        // Check if this payment is for a subscription
        const subscriptionId = paymentIntent.metadata?.subscription_id || 
                               (paymentIntent.invoice ? await getSubscriptionFromInvoice(paymentIntent.invoice) : null);

        if (!subscriptionId) {
          console.log('ℹ️ Payment intent not for subscription, skipping');
          return;
        }

        // Get subscription to find userId
        let subscription = await db.collection('subscriptions').findOne({ stripeSubscriptionId: subscriptionId });

        if (!subscription) {
          console.log('ℹ️ Subscription not found for payment intent, invoice.payment_succeeded will handle it');
          return;
        }

        const userId = subscription.userId;

        // Check if we need to get invoice details
        let invoiceId = paymentIntent.metadata?.invoice_id;
        let amount = paymentIntent.amount / 100;
        let currency = paymentIntent.currency || 'usd';
        let invoiceUrl = null;
        let shouldCreateRecord = true;

        if (paymentIntent.invoice) {
          try {
            const invoice = typeof paymentIntent.invoice === 'string'
              ? await getStripe().invoices.retrieve(paymentIntent.invoice)
              : paymentIntent.invoice;
            
            invoiceId = invoice.id;
            amount = invoice.amount_paid / 100;
            currency = invoice.currency || 'usd';
            invoiceUrl = invoice.hosted_invoice_url || null;

            // Check if billing record already exists
            const existingBilling = await db.collection('billing_history').findOne({ stripeInvoiceId: invoiceId });

            if (existingBilling) {
              console.log(`ℹ️ Billing record already exists for invoice ${invoiceId}`);
              shouldCreateRecord = false;
            }
          } catch (error) {
            console.error('Error retrieving invoice:', error);
            // Continue with payment intent data, use generated invoice ID if needed
            if (!invoiceId) {
              invoiceId = `pi_${paymentIntent.id}`;
            }
          }
        } else {
          // No invoice attached, use payment intent ID as fallback
          if (!invoiceId) {
            invoiceId = `pi_${paymentIntent.id}`;
          }
        }

        // Create billing history record if needed
        if (shouldCreateRecord && invoiceId) {
          const existingBilling = await db.collection('billing_history').findOne({ stripeInvoiceId: invoiceId });

          if (!existingBilling) {
            const bhId = crypto.randomUUID();
            await db.collection('billing_history').insertOne({
              id: bhId,
              userId,
              subscriptionId,
              stripeInvoiceId: invoiceId,
              stripePaymentIntentId: paymentIntent.id,
              amount,
              currency,
              status: 'paid',
              invoiceDate: new Date(paymentIntent.created * 1000),
              paidAt: new Date(paymentIntent.created * 1000),
              description: `Payment intent for subscription ${subscriptionId}`,
              createdAt: new Date(),
            });
            console.log(`✅ Billing record created from payment intent for subscription ${subscriptionId}`);
          } else {
            console.log(`ℹ️ Billing record already exists for ${invoiceId}`);
          }
        }
      } catch (error) {
        console.error('Error processing payment_intent.succeeded:', error);
      }
    } else {
      // Log other events but don't process them
      console.log(`ℹ️ Event ${event.type} received but not processed`);
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
  }
}
