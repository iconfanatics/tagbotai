import db from "./app/db.server";
import { unauthenticated } from "./app/shopify.server";

async function main() {
    console.log("Fetching the actual order list from Shopify to see how many meet > 49 USD subtotal...");
    
    // The merchant's known store
    const store = await db.store.findFirst();
    if (!store) return;
    
    const { admin } = await unauthenticated.admin(store.shop);
    
    let hasNextPage = true;
    let cursor: string | null = null;
    let qualifiedOrders = 0;
    let totalOrders = 0;

    let qualifiedDetails: any[] = [];
    
    while (hasNextPage) {
        const query = `
            query FetchAllOrders($cursor: String) {
                orders(first: 250, after: $cursor) {
                    pageInfo { hasNextPage, endCursor }
                    edges {
                        node {
                            id
                            subtotalPriceSet { shopMoney { amount } }
                            tags
                            createdAt
                        }
                    }
                }
            }
        `;
        const res = await admin.graphql(query, { variables: { cursor } });
        const data: any = await res.json();
        
        const edges = data.data?.orders?.edges || [];
        totalOrders += edges.length;
        
        for (const edge of edges) {
            const subtotal = parseFloat(edge.node.subtotalPriceSet?.shopMoney?.amount || "0");
            if (subtotal > 49) {
                qualifiedOrders++;
                qualifiedDetails.push({
                    id: edge.node.id,
                    subtotal,
                    tags: edge.node.tags,
                    createdAt: edge.node.createdAt
                });
            }
        }
        
        hasNextPage = data.data?.orders?.pageInfo?.hasNextPage || false;
        cursor = data.data?.orders?.pageInfo?.endCursor || null;
    }

    console.log(`\n================================`);
    console.log(`Total Orders in Shopify: ${totalOrders}`);
    console.log(`Orders with Subtotal > 49 USD: ${qualifiedOrders}`);
    console.log(`================================`);
    
    // Check how many actually have the SANY50 tag
    let taggedCount = 0;
    for (const d of qualifiedDetails) {
        if (d.tags && d.tags.some((t: string) => t.toLowerCase() === "sany50" || t.toLowerCase() === "momin50")) {
            taggedCount++;
        }
    }
    
    console.log(`Orders that successfully received the SANY50/Momin50 tag: ${taggedCount}`);
}

main().catch(console.error);
