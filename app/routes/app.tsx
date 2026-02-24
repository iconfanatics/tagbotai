import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, Link, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

import { authenticate } from "../shopify.server";

import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

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
          <Link to="/app/integrations">Integrations</Link>
          <Link to="/app/settings">Settings</Link>
          <Link to="/app/guide">Testing Guide</Link>
        </ui-nav-menu>
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
