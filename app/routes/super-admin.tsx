import { Outlet } from "react-router";
import { AppProvider as PolarisAppProvider, Frame } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export default function SuperAdminLayout() {
    return (
        <PolarisAppProvider i18n={polarisTranslations}>
            <Frame>
                <Outlet />
            </Frame>
        </PolarisAppProvider>
    );
}
