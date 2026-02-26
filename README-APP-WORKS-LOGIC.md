# TagBot AI: Smart Segmentation Engine Logic

This document details exactly how the TagBot AI Rules Engine evaluates customers, how it interacts with Shopify, and the difference between "Matching Customers" and "Times Fired".

## Core Tagging Concepts

### 1. The Rule Engine
A **Rule** consists of a Condition (e.g., *Total Spent > $500*) and a Target Tag (e.g., *VIP*). 

There are two primary ways a rule calculates and applies tags to customers:
- **Foreground (Live Trigger):** The rule fires immediately when a live customer makes a purchase on your store (Shopify sends a webhook).
- **Background (Historical Sync):** The rule processes your entire Shopify customer database in bulk when you click the "Sync Customers" button on your dashboard.

### 2. "Matching Customers" vs "Times Fired"

When you look at your "Manage Automations" table, you'll see two numbers:
- **Matching Customers:** The absolute total number of customers in your Shopify Database that currently possess the Target Tag.
- **Times Fired:** The total number of times TagBot AI's engine actively added or removed a tag from a customer (logged in the Activity Log).

#### Why are they different?
If you manually added the tag "Prospect" to 25 customers in Shopify *before* installing TagBot AI, and then you created a rule targeting "Prospect", the dashboard will show **Matching Customers: 25** but **Times Fired: 0**.

This happens because TagBot AI scans the customer profiles and recognizes that 25 people *already have the tag*. It doesn't need to "Fire" an automation to add it. An automation only "Fires" when TagBot algorithmically assigns a tag to a customer who *didn't have it before*.

---

## Example Scenarios

### Example 1: Creating a "Summer VIP" Rule (Total Spent > $1000)

**What you do:**
You configure a rule targeting `Summer VIP` for customers who have spent over $1,000. 

**What happens immediately:**
- The rule saves to the database.
- **Matching Customers:** 0
- **Times Fired:** 0

**What happens on "Sync Customers":**
- The app scans 1,000 past Shopify customers.
- It finds 30 people who have spent > $1000 but *don't* have the `Summer VIP` tag.
- It pushes the 30 tags to Shopify.
- **Matching Customers:** 30
- **Times Fired:** 30

### Example 2: The "Window Shoppers" Tag (Pre-existing Tags)

**What you do:**
You have been using Shopify for years. You have manually tagged 100 people with `Prospect`.
You create a TagBot AI rule: *Order Count Equals 0 -> Tag: `Prospect`*.

**What happens immediately:**
- The rule saves. 
- You click *"Sync Customers"*.
- TagBot AI looks at those 100 people who have 0 orders. Because they *already* have the `Prospect` tag, TagBot skips them to save API limits.
- **Matching Customers:** 100
- **Times Fired:** 0 (Because TagBot didn't have to do any work; the tags already existed).

**What happens next week:**
- 5 new people sign up for your newsletter but don't buy anything (Order Count: 0).
- TagBot AI evaluates them next time they trigger an event or sync, sees they have 0 orders and missing the tag, and automatically tags them.
- **Matching Customers:** 105
- **Times Fired:** 5 (TagBot AI did the work 5 times).

### Example 3: The "Collection Targeted" Rule

**What you do:**
You create a Collection Rule: *Bought from "Winter Collection" -> Tag: `Winter Enthusiast`*.

**What happens on Live Purchase (Webhook):**
1. A customer checks out at your Shopify Store.
2. Shopify instantly beams the Order Payload (Line Items, Prices) to TagBot AI.
3. TagBot AI's backend server wakes up (Cold Start).
4. TagBot analyzes the Line Items via GraphQL and determines they belong to the `Winter Collection`.
5. TagBot pushes the `Winter Enthusiast` tag to the customer profile in Shopify.
6. TagBot saves the action to the Activity Log Database.
- **Times Fired** increases by 1.
- **Matching Customers** increases by 1.

---

## Resolving Desyncs

Because you are utilizing the Vercel Serverless (Free) Tier, the application sleeps when no one is using it. When Shopify sends a webhook, the server has to "Cold Start," establishing a new database connection. 

If Shopify updates faster than the server can process the tag, the local database (which drives the "Matching Customers" count) might fall out of sync with Shopify.

**To resolve any inconsistencies:**
Simply return to your Dashboard and click **"Sync Customers"**. This forces TagBot AI's background queue to pull the latest truth from Shopify and rewrite the local database, permanently fixing the desync.

---

## 🤖 AI Natural Language Prompts (Testing Guide)

To test the **Natural Language Rule Engine** built into the `/app/rules/new` page, simply paste any of the following examples into the text box and click "**✨ Generate with AI**". The AI will intelligently map your intent directly into the correct rule parameters automatically:

1. **"Tag people who have spent more than $500 as VIP"**
   *(The AI translates to: Metric > Total Spent > Greater Than > 500 > Target Tag: VIP)*

2. **"Create a Loyal tag for customers with exactly 5 orders"**
   *(The AI translates to: Metric > Order Count > Equals > 5 > Target Tag: Loyal)*

3. **"Find customers who haven't ordered in the last 90 days and tag them as At-Risk"**
   *(The AI translates to: Metric > Last Order Date > Is Before > [Calculates Date 90 days ago] > Target Tag: At-Risk)*

4. **"Tag anyone with a .edu email address as Student"**
   *(The AI translates to: Metric > Email Domain > Contains > .edu > Target Tag: Student)*
