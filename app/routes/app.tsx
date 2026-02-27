import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, Link, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

import { Spinner } from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { sendWelcomeEmail } from "../services/email.server";

import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const existingStore = await db.store.findUnique({ where: { shop } });

  if (!existingStore) {
    // This is a brand new installation! Send the Welcome Email.
    try {
      const response = await admin.graphql(`
          #graphql
          query {
            shop {
              contactEmail
              email
              name
            }
          }
        `);
      const data = await response.json();
      const email = data.data?.shop?.contactEmail || data.data?.shop?.email;
      const shopName = data.data?.shop?.name || shop;

      if (email) {
        // Send it asynchronously so we don't block the Shopify App install redirect
        sendWelcomeEmail(shopName, email).catch(console.error);
      }
    } catch (e) {
      console.error("[INSTALL HOOK] Failed to fetch shop email for welcome payload", e);
    }
  }

  // Ensure the store is registered and active in our database
  await db.store.upsert({
    where: { shop },
    create: { shop, isActive: true },
    update: { isActive: true }
  });

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider
        i18n={polarisTranslations}
        linkComponent={({ children, url, external, ...rest }) => {
          if (external) {
            return <a href={url} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>;
          }
          return <Link to={url} {...rest}>{children}</Link>;
        }}
      >
        <ui-nav-menu>
          <Link to="/app" rel="home">Home</Link>
          <Link to="/app/rules">Rules</Link>
          <Link to="/app/cleanup">Cleanup</Link>
          <Link to="/app/roi">Revenue ROI</Link>
          <Link to="/app/workflows">Workflows</Link>
          <Link to="/app/predict">Predictive</Link>
          <Link to="/app/integrations">Integrations</Link>
          <Link to="/app/pricing">Plans</Link>
          <Link to="/app/settings">Settings</Link>
          <Link to="/app/guide">Testing Guide</Link>
        </ui-nav-menu>
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shown during React hydration on first load (cold start / initial page render)
// Prevents a completely blank white screen before JS has initialized
export function HydrateFallback() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="stylesheet" href={polarisStyles} />
        <title>TagBot AI — Loading...</title>
      </head>
      <body>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: '16px',
          backgroundColor: '#f6f6f7'
        }}>
          <Spinner size="large" />
          <p style={{ fontFamily: 'Inter, sans-serif', color: '#6d7175', fontSize: '14px', margin: 0 }}>
            TagBot AI is loading...
          </p>
        </div>
      </body>
    </html>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
