# Staging Environment Setup Guide

Complete guide based on actual setup of TagBot AI staging. Follow exactly in order.

---

## Step 1 — Create Staging App in Shopify Partners

1. Go to [partners.shopify.com](https://partners.shopify.com) → **Apps → Create App**
2. Name it **"TagBot AI (Staging)"**
3. After creation, go to **Client Credentials** → copy the **Client ID** and **Client Secret**
4. Go to **App Setup** → enable **"Embed in Shopify admin"** ← **critical, do this now**

---

## Step 2 — Create a Dev Test Store

1. In Partners → **Stores → Add Store → Create development store**
2. Select **"Test an app or theme"**
3. Give it a name like "TagBot Dev Store"

---

## Step 3 — Create the Staging Git Branch

```bash
cd ~/tag-bot-ai-smart-segmentation
git checkout -b staging
git push origin staging
```

---

## Step 4 — Create the Staging Shopify Config File

Run from inside the project folder:

```bash
shopify app config link --config shopify.app.staging.toml
```

Select **"TagBot AI (Staging)"** when prompted. Then update the generated file to match production — set the correct `application_url`, `redirect_urls`, `scopes`, and webhook subscriptions. Use `shopify.app.toml` as the template, just swap the URLs.

Deploy the config to Shopify:

```bash
shopify app deploy --config shopify.app.staging.toml --force
```

---

## Step 5 — Push Staging Config to GitHub

```bash
git add shopify.app.staging.toml
git commit -m "Add staging Shopify config"
git push origin staging
```

Vercel will auto-deploy the `staging` branch. Copy the Preview URL — it will look like:
`https://tagbotai-git-staging-iconfanatics-projects.vercel.app`

---

## Step 6 — Set Vercel Environment Variables

Go to **Vercel → Project → Settings → Environment Variables**.

These vars need **different values** for Production vs Preview:

| Variable | Production | Preview (Staging) |
|---|---|---|
| `SHOPIFY_API_KEY` | Production Client ID | **Staging Client ID** |
| `SHOPIFY_API_SECRET` | Production Client Secret | **Staging Client Secret** |
| `SHOPIFY_APP_URL` | `https://tagbotai.vercel.app` | **Staging Vercel URL** |

Everything else (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GEMINI_API_KEY`, `PRISMA_DB_URL`, `SCOPES`) → set to **All Environments**, same values.

> **Note:** If you get "No environment variables were created", the var already exists. Edit it and enable the Preview checkbox instead.

---

## Step 7 — Disable Vercel Deployment Protection ← Easy to Miss

Go to **Vercel → Project → Settings → Deployment Protection**

Set **"Vercel Authentication"** to **Disabled** for Preview.

Without this, Shopify can't load the staging app inside its iframe — it will say "refused to connect".

---

## Step 8 — Install Staging App on Dev Store

1. Shopify Partners → **TagBot AI (Staging) → Select store** → pick your dev store
2. Click **Install**

The staging app should now load inside the Shopify admin.

---

## Daily Workflow

```bash
# Work on new features:
git checkout staging
# ... make changes ...
git push origin staging       # auto-deploys to staging Vercel URL

# Test in your dev store → when ready:
git checkout main
git merge staging
git push origin main          # goes live to production merchants
```
