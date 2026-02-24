# Project Name: AI-Powered Customer Segmentation & Auto-Tagger

## 1. Project Overview
This app is designed for Shopify Merchants to automate customer management by applying tags based on customer behavior (Spending, Frequency, Recency). It aims to help merchants create targeted marketing lists without manual work.

---

## 2. Core Features (Tier-based)
- **Free:** Manual sync, Basic tagging (New vs Returning), 200 customers/mo.
- **Growth ($):** Real-time tagging (Webhooks), Custom rule builder, 2,000 customers/mo.
- **Pro ($$):** AI Insights, RFM Analysis, Unlimited customers, Integration with Klaviyo/Mailchimp.

---

## 3. Development Phases (Step-by-Step)

### Phase 1: Foundation & Data Sync
* **Database Schema:** Create tables for `stores`, `rules`, `customers`, and `activity_logs`.
* **OAuth & App Bridge:** Setup Shopify authentication and embed the app in the admin.
* **Webhook Integration:** Listen to `orders/paid` and `customers/create`.
* **Background Jobs:** Setup background processing to handle tagging without slowing down the server.

### Phase 2: Rule Engine & Tagging Logic
* **Condition Builder:** Develop a logic engine that checks conditions:
    * `if (total_spent > X) AND (order_count > Y) -> Apply Tag 'VIP'`.
    * `if (last_order_date > 90 days) -> Apply Tag 'Inactive'`.
* **Tag Management:** Implement API calls to Shopify Admin API (`/customers/{id}.json`) to add/remove tags.
* **Conflict Handling:** Ensure existing manual tags are not deleted unless specified.

### Phase 3: Dashboard & Analytics (UI/UX)
* **KPI Cards:** Display Total Tagged, Active VIPs, and Churning Customers.
* **Visualization:** Use charts to show segment distribution.
* **Activity Feed:** A real-time log of which customer got which tag and why.

---

## 4. Premium Rules to Implement (Marketing Focus)
1.  **The "Big Spenders":** Total lifetime spend > $1000.
2.  **The "Loyalists":** More than 5 orders in 6 months.
3.  **The "Window Shoppers":** Created account but 0 orders.
4.  **The "At Risk":** Formerly active but no purchase in 90 days.
5.  **The "Product Enthusiasts":** Purchased from a specific collection (e.g., 'Winter Collection').

---

## 5. API & Webhook Requirements
- **Scopes:** `read_customers`, `write_customers`, `read_orders`.
- **Webhooks:**
    - `orders/paid`: To trigger re-calculation of spending/frequency tags.
    - `customers/redact`: For GDPR compliance.
    - `app/uninstalled`: To clean up store data.

---

## 6. UI Structure (Polaris Based)
- **Home:** Overview and Stats.
- **Rules:** Table of active automation rules (Create/Edit/Delete).
- **Insights:** AI-generated suggestions for new segments.
- **Logs:** History of tagging actions.
