import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, payload, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    // This is where you would handle the shop redact webhook.
    // We already handle app uninstalls, which functionally unlinks the shop too.
    return new Response(null, { status: 200 });
};
