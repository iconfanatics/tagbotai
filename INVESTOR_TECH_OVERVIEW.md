# TagBot AI: Smart Segmentation & Automation
## Investor & Technical Overview

This document provides a high-level overview of the architecture, technology stack, and engineering principles behind **TagBot AI**. It is designed to be easily digestible for technical investors, stakeholders, and potential technical co-founders.

---

## 1. Executive Summary & Value Proposition

**TagBot AI** is an intelligent automation engine for Shopify merchants. It replaces tedious manual customer bucketing with an autonomous rule engine that dynamically tags, segments, and targets customers based on their real-time shopping behavior. 

By applying smart tags (e.g., `VIP`, `High Spender`, `At-Risk`, `Churning`), merchants can unlock highly targeted marketing flows, send automated win-back discounts, and seamlessly sync segments to external CRM platforms.

### Key Market Differentiators:
* **Real-time Operations:** Driven by webhooks, the app responds to purchases instantly.
* **Proactive Intelligence:** Uses built-in algorithms to flag high-value customers at risk of churning before they are lost.
* **Deep Integrations:** Automatically pipes curated segments directly into Klaviyo and Mailchimp without Zapier or middleware.

---

## 2. The Technology Stack

We constructed TagBot AI using a modern, serverless-ready, full-stack JavaScript ecosystem. This allows for rapid iteration, a unified codebase, and seamless scalability.

### **Frontend (Client-Side Interface)**
* **React.js:** The industry standard for dynamic user interfaces.
* **Shopify App Bridge & Polaris:** Utilizing Shopify's native component library ensures the application feels like a built-in feature of the Shopify Admin, requiring zero learning curve for merchants.
* **Recharts:** Powers the interactive, lazy-loaded dashboard analytics without bloating the initial page load.

### **Backend (Server & Middleware)**
* **Remix (Node.js):** A modern full-stack web framework that excels at Server-Side Rendering (SSR). It allows us to colocate our UI components with server-side database logic, drastically reducing API boilerplate.
* **Shopify GraphQL API:** We securely query Shopify's newest and fastest APIs to retrieve highly specific data (like line-item collections) while avoiding massive REST API payloads.
* **Background Queue Worker:** Heavy background operations (like retroactively syncing 10,000 customers) are offloaded from the main UI thread to prevent timeouts, keeping the dashboard instantly responsive.

### **Database & Data Layer**
* **Prisma ORM:** A next-generation Object-Relational Mapper that enforces strict TypeScript types on our database queries. This translates to fewer runtime bugs and highly secure data transactions.
* **SQLite (Current):** Lightweight and fast for the MVP stage. The Prisma ORM architecture makes it fundamentally trivial to migrate to a globally distributed **PostgreSQL** cluster (e.g., Supabase, Heroku, or AWS RDS) as soon as traffic scales up.
* **Memory Caching:** Implements an LRU (Least Recently Used) cache in the Node.js layer to prevent redundant database hits during massive web traffic spikes (like Black Friday).

---

## 3. Core Architecture Flow

Instead of constantly polling Shopify for data, TagBot AI relies on an **Event-Driven Webhook Architecture**.

1. **The Event:** A buyer completes a purchase on a Shopify storefront.
2. **The Webhook:** Shopify instantly securely pings our server (`orders/paid` webhook).
3. **The Engine:** TagBot AI loads the store's active rules from the database (via Cache) and evaluates the customer's total spend, order count, and the specific collections they bought from.
4. **The Action:** TagBot instructs Shopify to append new Tags, updates the Customer Note, and automatically generates a unique 20% off discount code if they just hit VIP status.
5. **The Sync:** A background worker detects the VIP tag and updates the merchant's Klaviyo or Mailchimp account via REST API.

---

## 4. Security & Compliance

Enterprise readiness is built into the foundation:
* **Session Isolation:** All authentication flows use encrypted, HttpOnly, secure cookies.
* **GDPR Compliance:** Mandatory Shopify webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) are fully implemented to automate data privacy deletion requests.
* **Super Admin Controls:** We built an isolated, password-protected `/super-admin` portal distinct from the main application to monitor global churn, app installations, and MRR (Monthly Recurring Revenue).
* **Billing API Integration:** Enforces Shopify's native App Subscriptions API, ensuring secure revenue collection and plan-gating logic (Free vs. Growth vs. Pro vs. Elite).

---

## 5. Roadmap to Scale (Next Steps)

Because the architecture relies on stateless Node.js workers and the Prisma ORM, scaling TagBot AI to serve thousands of stores involves:
1. Swapping the SQLite local file for a managed **PostgreSQL** database.
2. Migrating the background queue to a dedicated Redis cluster (e.g., BullMQ) for distributed job processing.
3. Deploying the Remix application natively on Vercel or AWS Lambda for infinite, auto-scaling serverless capacity.
