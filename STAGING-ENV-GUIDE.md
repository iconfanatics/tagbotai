# How to Set Up a Shopify App Staging Environment on Vercel
**Objective:** Create a safe, isolated clone of TagBot AI where you can push and test new code without affecting the live Production app or crashing your active merchants.

---

## Step 1: Create the "Staging App" in Shopify Partners
Because Shopify requires completely unique API Keys and redirect URLs for each application instance, you cannot use your Live app for testing.

1. Log into your **[Shopify Partner Dashboard](https://partners.shopify.com/)**.
2. Go to **Apps** in the left sidebar.
3. Click **Create App** (or "Create App Manually").
4. Name it **"TagBot AI (Staging)"**.
5. Once created, go to **Client Credentials** and copy the new `Client ID` and `Client Secret`. *Keep these handy.*

## Step 2: Create a Development Test Store
You need a fake store to install your fake Staging app onto.
1. Still inside the Partner Dashboard, click **Stores** on the left sidebar.
2. Click **Add Store** -> **Create development store**.
3. Select **"Test an app or theme"**.
4. Name it something like "TagBot Dev Test" and click Create.

## Step 3: Set Up the Vercel Staging Branch
Vercel has "Preview Deployments" built-in, meaning any branch other than `main` automatically gets its own isolated preview URL!

1. Open your terminal in VSCode and run the following to create and switch to a staging branch:
   ```bash
   git checkout -b staging
   git push origin staging
   ```
2. Log into your **[Vercel Dashboard](https://vercel.com/api/auth/login)** and go to your `tagbot-ai` project.
3. You will see a new deployment building under the "Preview" tab for the `staging` branch. 
4. Once it finishes building, copy that **exact Preview URL** (it will look something like `https://tagbot-ai-git-staging-yourusername.vercel.app`).

## Step 4: Link Vercel to your Staging App
1. Go back to your **TagBot AI (Staging)** App in the Shopify Partner Dashboard.
2. Go to **App setup**.
3. Under **App URL**, paste your Vercel Preview URL.
4. Under **Allowed redirection URL(s)**, paste:
   `https://[YOUR_VERCEL_PREVIEW_URL]/auth/callback`
   `https://[YOUR_VERCEL_PREVIEW_URL]/api/auth/callback`
5. Save your changes.

## Step 5: Duplicate the Environment Variables for Staging
Vercel allows you to have different `.env` variables for Production vs Preview. Since your Production app uses your Live Shopify API keys, your Preview app needs your Staging Shopify API keys!

1. In your **Vercel Dashboard**, go to your Project **Settings** -> **Environment Variables**.
2. Find your `SHOPIFY_API_KEY`. Uncheck "Preview" so it only applies to Production.
3. Add a **New** `SHOPIFY_API_KEY`:
   - Value: The `Client ID` from your *Staging* app.
   - Environments: Check **ONLY "Preview"**.
4. Repeat this exact process for `SHOPIFY_API_SECRET` and `SHOPIFY_APP_URL` (using the Vercel Preview URL you copied earlier).

## The Final Result: Your New Workflow
You have now fully detached your testing environment from your live environment!

**When building new features:**
1. Do your work in VSCode on the `staging` branch.
2. Run `git push origin staging`.
3. Vercel automatically deploys it.
4. Go to your `TagBot Dev Test` Shopify store, click on `TagBot AI (Staging)`, and test your feature safely.
5. If it works perfectly, go to GitHub and click **"Merge Pull Request"** to merge `staging` into `main`.
6. Vercel will automatically deploy it to your live Production merchants!
