# TagBot AI: Smart Segmentation & Auto-Tagger

TagBot AI is an intelligent Shopify application designed to replace manual customer segmentation. It provides an autonomous engine that evaluates real-time shopping behaviors, automatically tagging customers and syncing segments efficiently across marketing platforms like Klaviyo and Mailchimp.

---

## 🚀 Key Features

*   **Real-Time Automation Workflow**: Respond to orders immediately using Shopify Webhooks.
*   **Intelligent Auto-Tagging**: Construct rules based on metrics such as `Total Spent`, `Order Count`, or specific `Collections` purchased.
*   **Predictive AI Churn Alerts**: Dynamically identify high-value VIP customers who are at risk of churning before they are lost forever.
*   **Loyalty Mechanics**: Send automated discounts and win-back offers seamlessly based on customer spending shifts.
*   **Premium Omnichannel Syncing**: Asynchronously push dynamically assigned tags instantaneously to powerful ESPs like **Klaviyo** and **Mailchimp**.
*   **Robust & Secure Data Management**: Full compliance with Shopify GDPR standards via mandatory data request and redaction webhooks.

## 🛠️ Technology Stack

*   **Frontend**: React, React Router
*   **UI Components**: Shopify App Bridge, Shopify Polaris, Recharts (Lazy Loaded)
*   **Backend framework**: Remix.js (Node.js)
*   **API Protocol**: Shopify GraphQL Admin API
*   **Database ORM**: Prisma ORM
*   **Production Database**: Turso (LibSQL / Edge SQLite)
*   **Caching & Optimization**: In-memory LRU Node.js constraints, Native Asynchronous Queue Worker.

---

## 🏗️ Local Development Setup

### Prerequisites
*   Node.js >= 20.x
*   A Shopify Partner Account and Development Store
*   A free Turso Database (optional for local, but recommended)

### Installation
1.  **Clone the Repository**
    ```bash
    git clone https://github.com/your-username/tag-bot-ai-smart-segmentation.git
    cd tag-bot-ai-smart-segmentation
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Link to your Shopify Partner App**
    Connect the codebase to your Shopify Partner Dashboard application:
    ```bash
    npm run shopify app config link
    ```

4.  **Database Strategy**
    Generate the Prisma Client and migrate your local database schema. Our project uses `driverAdapters` for ultimate Edge compatibility.
    ```bash
    npx prisma generate
    npx prisma migrate dev --name init
    ```

5.  **Start the Local Server**
    Run the Shopify CLI development command to spin up a Cloudflare/ngrok tunnel and boot the React UI:
    ```bash
    npm run dev
    ```

---

## ☁️ Deployment (Vercel & Turso)

This repository is optimized for Edge-first serverless deployment using **Vercel** and **Turso**.

1.  **Turso Provisioning**
    Create a new database using the Turso CLI or dashboard:
    ```bash
    turso db create tagbot-ai-db
    turso db show tagbot-ai-db           # -> Returns your TURSO_DATABASE_URL
    turso db tokens create tagbot-ai-db  # -> Returns your TURSO_AUTH_TOKEN
    ```

2.  **Vercel Environment Variables**
    Add the following core components to your Vercel Project Settings:
    *   `SHOPIFY_API_KEY`: Your App Client ID.
    *   `SHOPIFY_API_SECRET`: Your App Client Secret.
    *   `SCOPES`: `write_customers,read_customers,write_orders,read_orders,read_products`
    *   `TURSO_DATABASE_URL`: `libsql://your-db-name.turso.io`
    *   `TURSO_AUTH_TOKEN`: Your generated JWT authentication string.
    *   `SHOPIFY_APP_URL`: Your Vercel domain (e.g., `https://your-vercel-domain.vercel.app`)
    *   `NODE_ENV`: `production`

3.  **Vercel Build Command Override**
    Go into **Settings > Build & Development Settings**, turn `Override` ON for Build Command, and enter:
    ```bash
    npm run vercel-build
    ```
    This securely connects to Turso and synchronizes your schema over the Edge network before serving the React output.

4.  **Finalize in Shopify**
    Navigate to your Shopify Partner Dashboard -> App Setup, and inject your live Vercel domains into the **App URL** and **Allowed redirection URI(s)** inputs.

---

## 🗄️ Project Architecture & Services

*   `app/routes/app._index.tsx` – The Core Merchant Dashboard with Analytics & Rules Overviews.
*   `app/routes/super-admin._index.tsx` – A hardened administrative console for managing subscriptions, viewing global metrics, and checking error states.
*   `app/services/rule.server.ts` – The brain of the calculation logic for evaluating standard and premium metric criteria on the fly.
*   `app/services/tags.server.ts` – Centralized operations for executing Tag additions, automated discounts, and Shopify API calls.
*   `app/services/queue.server.ts` – Fire-and-forget asynchronous queue processor to offload expensive operations (Historical Syncs) to the background without freezing HTTP streams.
*   `app/services/cache.server.ts` – Local LRU mechanism to prevent unnecessary `db.store.findUnique` requests hitting the Turso Edge layer during heavy traffic bursts.

---

## 🔒 Super Admin Access

By default, the application is protected securely via encrypted sessions inside `app/adminSession.server.ts`. To access the backend dashboard at `/super-admin/login`, simply configure your environment securely with a custom `SUPER_ADMIN_PASSWORD` or it will fallback to generating local developer access.

---

## 📈 Marketing Integrations

TagBot AI supports multi-channel integrations gated exclusively under the **Elite Tier Plan**:
*   **Klaviyo Server**: `syncTagsToKlaviyo()` automatically performs profile event appends asynchronously.
*   **Mailchimp Server**: `syncTagsToMailchimp()` automatically updates the given audience `MEMBER_HASH` with newly identified data contexts.
