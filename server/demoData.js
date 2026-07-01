// ---------------------------------------------------------------------------
// demoData.js — realistic sample emails so the dashboard can be explored
// without connecting a real Gmail account.
// ---------------------------------------------------------------------------
import { upsertEmail } from './db.js';
import { classifyEmail } from './classifier.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const SAMPLES = [
  // Stripe — offer pipeline
  { d: 40, from: 'Stripe Careers <no-reply@greenhouse.io>', subject: 'Thank you for applying to Stripe — Backend Engineer', body: 'Hi, thank you for applying to the Backend Engineer position at Stripe. We have received your application and our team will review it shortly.' },
  { d: 34, from: 'Stripe Recruiting <recruiting@stripe.com>', subject: 'Stripe — Online coding assessment for Backend Engineer', body: 'We would like you to complete a coding challenge on HackerRank as the next step. Please finish the take-home assessment within 5 days.' },
  { d: 27, from: 'Stripe Recruiting <recruiting@stripe.com>', subject: 'Schedule your technical interview with Stripe', body: 'Great news! We would love to set up a technical phone interview. Please use the Calendly link to book a time that works for you.' },
  { d: 12, from: 'Stripe Recruiting <recruiting@stripe.com>', subject: 'Stripe Offer — Backend Engineer', body: 'We are thrilled to extend you an offer for the Backend Engineer role. Your offer letter with starting salary details is attached. Welcome aboard!' },

  // Datadog — rejected after interview
  { d: 55, from: 'Datadog <careers@datadoghq.com>', subject: 'We received your application — Software Engineer', body: 'Thanks for applying to Datadog. Your application has been received and is under review.' },
  { d: 47, from: 'Datadog Recruiting <talent@datadoghq.com>', subject: 'Datadog — phone screen', body: 'We would like to schedule a phone screen with our hiring manager. What is your availability next week?' },
  { d: 30, from: 'Datadog Recruiting <talent@datadoghq.com>', subject: 'Update on your Datadog application', body: 'Thank you for taking the time to interview with us. Unfortunately, we have decided to move forward with other candidates for this position. We wish you the best of luck.' },

  // Notion — assessment stage
  { d: 20, from: 'Notion <jobs@lever.co>', subject: 'Application received — Product Designer at Notion', body: 'Thank you for your interest in Notion. We have received your application for the Product Designer role.' },
  { d: 9, from: 'Notion Talent <talent@makenotion.com>', subject: 'Notion — design assessment', body: 'As a next step, please complete the take-home design challenge attached. You will have one week to submit your assignment.' },

  // Airbnb — interview stage
  { d: 18, from: 'Airbnb Careers <careers@airbnb.com>', subject: 'Thanks for applying to Airbnb — Data Scientist', body: 'We have received your application for the Data Scientist position and will be in touch.' },
  { d: 4, from: 'Airbnb Recruiting <recruiting@airbnb.com>', subject: 'Airbnb — interview invitation', body: 'The hiring team would like to invite you to a final onsite interview round. Please share your availability so we can set up some time.' },

  // Shopify — applied only
  { d: 6, from: 'Shopify <no-reply@smartrecruiters.com>', subject: 'Your application to Shopify was submitted', body: 'Thanks for applying! Your application for the Senior Frontend Developer role has been submitted successfully. We are reviewing your application.' },

  // Figma — rejected early
  { d: 25, from: 'Figma <jobs@ashbyhq.com>', subject: 'Update on your application to Figma', body: 'Thank you for applying to Figma. After careful review, we regret to inform you that we will not be moving forward with your application at this time.' },

  // A noise email that should NOT be classified as a job
  { d: 2, from: 'Weekly Newsletter <news@techcrunch.com>', subject: 'This week in tech: funding rounds and product launches', body: 'Here is your weekly roundup of the biggest stories in technology and startups.' },
];

export function loadDemoData() {
  let inserted = 0;
  SAMPLES.forEach((s, i) => {
    const receivedAt = now - s.d * DAY;
    const fromMatch = s.from.match(/^(.*?)\s*<([^>]+)>$/);
    const fromName = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : '';
    const fromEmail = fromMatch ? fromMatch[2].toLowerCase() : s.from.toLowerCase();

    const emailInput = { subject: s.subject, snippet: s.body, body: s.body, fromName, fromEmail };
    const c = classifyEmail(emailInput);

    upsertEmail({
      id: `demo-${i}-${receivedAt}`,
      thread_id: `demo-thread-${c.company}`,
      from_name: fromName,
      from_email: fromEmail,
      subject: s.subject,
      snippet: s.body,
      body: s.body,
      received_at: receivedAt,
      company: c.company,
      position: c.position,
      status: c.status,
      confidence: c.confidence,
      is_job_related: c.isJobRelated ? 1 : 0,
      created_at: Date.now(),
    });
    inserted += 1;
  });
  return inserted;
}
