# Inspired Analyst

Production web application built with Next.js.

## Current Architecture

The app  runs as a Node.js/Next.js service:
- Frontend and API routes are implemented in Next.js
- Runtime is Node.js (see `npm run start`)
- Data services are handled through the project scripts and current backend integrations in this repo

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS 4
- MongoDB
- Stripe
- AWS S3 SDK

## Requirements

- Node.js 20+
- npm 10+

## Local Development

1. Install dependencies:
   - `npm install`
2. Configure environment variables:
   - Create and populate `.env.local` (based on your deployment environment)
3. Start development server:
   - `npm run dev`
4. Open:
   - [http://localhost:3000](http://localhost:3000)

## Production Commands

- Build: `npm run build`
- Start (standalone): `npm run start`
- Start (standard Next runtime): `npm run start:local`

## Data and Maintenance Scripts

Common scripts (see `package.json` for full list):
- `npm run migrate:data`
- `npm run migrate:postgres-to-mongo`
- `npm run create-analysts`
- `npm run create-plans`

## Notes

- Any old documentation that references a FastAPI backend is outdated.
- Use this README as the source of truth for the current project structure.
Jenkins Pipeline Test Trigger
Final Pipeline Validation Test
Testing the webhook listener!
Final Jenkins Webhook Auto-Trigger Test
