import db from "../db.server";
import { syncTagsToKlaviyo } from "./klaviyo.server";
import { syncTagsToMailchimp } from "./mailchimp.server";
import { dispatchWorkflowActions } from "./workflows.server";

export async function manageCustomerTags(
  admin: any,
  storeId: string,
  customerId: string,
  tagsToAdd: string[],
  tagsToRemove: string[],
  isHistoricalSync = false // Historical syncs don't count against the monthly limit
) {
  // Limit Check for tagging
  let allowedToTag = true;
  let syncTagsToNotes = false;
  let klaviyoApiKey: string | null = null;
  let klaviyoAccessToken: string | null = null;
  let klaviyoIsActive = false;
  let mailchimpApiKey: string | null = null;
  let mailchimpServerPrefix: string | null = null;
  let mailchimpListId: string | null = null;
  let isElitePlan = false;

  const store = await db.store.findUnique({ where: { id: storeId } });

  if (store) {
    syncTagsToNotes = store.syncTagsToNotes;
    klaviyoApiKey = store.klaviyoApiKey;
    klaviyoAccessToken = store.klaviyoAccessToken;
    klaviyoIsActive = store.klaviyoIsActive;
    mailchimpApiKey = store.mailchimpApiKey;
    mailchimpServerPrefix = store.mailchimpServerPrefix;
    mailchimpListId = store.mailchimpListId;
    isElitePlan = store.planName === "Elite Plan";

    if (!isHistoricalSync && tagsToAdd.length > 0) {
      let limit = 0;
      const plan = store.planName.toLowerCase();
      if (plan.includes("free") || plan === "") limit = 100;
      else if (plan.includes("growth")) limit = 1000;
      else limit = Infinity; // Pro, Elite

      if (store.monthlyCustomerTagCount + tagsToAdd.length > limit) {
        console.log(`Store ${store.shop} hit tag limit (${limit}). Skipping ${tagsToAdd.length} tag add.`);
        allowedToTag = false;
        tagsToAdd = [];
      } else {
        await db.store.update({
          where: { id: storeId },
          data: { monthlyCustomerTagCount: { increment: tagsToAdd.length } }
        });
      }
    }
  }

  // 1. Add Tags
  if (tagsToAdd.length > 0 && allowedToTag) {
    const addResponse = await admin.graphql(
      `#graphql
        mutation tagsAdd($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          id: `gid://shopify/Customer/${customerId}`,
          tags: tagsToAdd,
        },
      }
    );
    const addData = await addResponse.json();
    if (addData.data?.tagsAdd?.userErrors?.length > 0) {
      console.error("[TAG_SERVICE] Error adding tags:", addData.data.tagsAdd.userErrors);
    }
  }

  // 2. Remove Tags
  if (tagsToRemove.length > 0) {
    const removeResponse = await admin.graphql(
      `#graphql
        mutation tagsRemove($id: ID!, $tags: [String!]!) {
          tagsRemove(id: $id, tags: $tags) {
            node {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          id: `gid://shopify/Customer/${customerId}`,
          tags: tagsToRemove,
        },
      }
    );
    const removeData = await removeResponse.json();
    if (removeData.data?.tagsRemove?.userErrors?.length > 0) {
      console.error("[TAG_SERVICE] Error removing tags:", removeData.data.tagsRemove.userErrors);
    }
  }

  // 3. Update Customer Notes
  if (syncTagsToNotes && tagsToAdd.length > 0 && allowedToTag) {
    const timestamp = new Date().toISOString().split('T')[0];
    const noteAppend = `\n[TagBot AI - ${timestamp}] Applied tags: ${tagsToAdd.join(", ")} due to rule matches.`;

    // Fetch existing note first
    try {
      const customerQuery = await admin.graphql(
        `#graphql
          query getCustomerNote($id: ID!) {
            customer(id: $id) {
              note
            }
          }
        `,
        {
          variables: {
            id: `gid://shopify/Customer/${customerId}`
          }
        }
      );
      const customerData = await customerQuery.json();
      const existingNote = customerData.data?.customer?.note || "";

      const newNote = existingNote + noteAppend;

      const updateResponse = await admin.graphql(
        `#graphql
          mutation customerUpdate($input: CustomerInput!) {
            customerUpdate(input: $input) {
              customer {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            input: {
              id: `gid://shopify/Customer/${customerId}`,
              note: newNote,
            }
          }
        }
      );
      const updateData = await updateResponse.json();
      if (updateData.data?.customerUpdate?.userErrors?.length > 0) {
        console.error("Error updating customer note", updateData.data.customerUpdate.userErrors);
      }
    } catch (err) {
      console.error("Failed to sync customer note", err);
    }
  }

  /* 
  // 4. Async Marketing Sync (DISABLED - Moved to Manual Push)
  if (isElitePlan && allowedToTag && tagsToAdd.length > 0) {
    if (klaviyoApiKey || mailchimpApiKey) {
      // ... existing automatic sync logic ...
    }
  }
  */

  // 5. Update Local Database Cache
  if (allowedToTag && (tagsToAdd.length > 0 || tagsToRemove.length > 0)) {
    try {
      const dbCustomer = await db.customer.findUnique({
        where: { id_storeId: { id: customerId, storeId } }
      });

      if (dbCustomer) {
        let currentTags = dbCustomer.tags ? dbCustomer.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
        if (tagsToAdd.length > 0) currentTags = [...currentTags, ...tagsToAdd];
        if (tagsToRemove.length > 0) currentTags = currentTags.filter(t => !tagsToRemove.includes(t));

        // Deduplicate before saving
        currentTags = Array.from(new Set(currentTags));

        await db.customer.update({
          where: { id_storeId: { id: customerId, storeId } },
          data: { tags: currentTags.join(", ") }
        });
      }
    } catch (err) {
      console.error("[TAG_SERVICE] Failed to update local customer tags cache:", err);
    }
  }

  // ── Workflow Actions (Additive, fire-and-forget, never blocks tagging) ──
  if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
    dispatchWorkflowActions(storeId, customerId, tagsToAdd, tagsToRemove)
      .catch(err => console.error('[WORKFLOW] dispatch error:', err));
  }

  return { success: true, tagsAdded: tagsToAdd, tagsRemoved: tagsToRemove };
}

export async function manageOrderTags(
  admin: any,
  storeId: string,
  orderId: string,
  customerId: string | null, // Optional, purely for logging
  tagsToAdd: string[],
  tagsToRemove: string[],
  isHistoricalSync = false // Historical syncs don't count against the monthly limit
) {
  let allowedToTag = true;

  const store = await db.store.findUnique({ where: { id: storeId } });

  if (store) {
    if (!isHistoricalSync && tagsToAdd.length > 0) {
      let limit = 0;
      const plan = store.planName.toLowerCase();
      if (plan.includes("free") || plan === "") limit = 100;
      else if (plan.includes("growth")) limit = 1000;
      else limit = Infinity;

      if (store.monthlyOrderTagCount + tagsToAdd.length > limit) {
        console.warn(`[LIMIT_HIT] Store ${store.shop} (Plan: ${store.planName}) reached tag limit of ${limit}. Cannot add tags: ${tagsToAdd.join(", ")} to order ${orderId}.`);
        allowedToTag = false;
        tagsToAdd = [];
      } else {
        await db.store.update({
          where: { id: storeId },
          data: { monthlyOrderTagCount: { increment: tagsToAdd.length } }
        });
      }
    }
  }

  // 1. Add Tags
  if (tagsToAdd.length > 0 && allowedToTag) {
    const addResponse = await admin.graphql(
      `#graphql
        mutation tagsAdd($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          id: `gid://shopify/Order/${orderId}`,
          tags: tagsToAdd,
        },
      }
    );
    const addData = await addResponse.json();
    if (addData.data?.tagsAdd?.userErrors?.length > 0) {
      console.error("[TAG_SERVICE] Error adding order tags:", addData.data.tagsAdd.userErrors);
    }
  }

  // 2. Remove Tags
  if (tagsToRemove.length > 0) {
    const removeResponse = await admin.graphql(
      `#graphql
        mutation tagsRemove($id: ID!, $tags: [String!]!) {
          tagsRemove(id: $id, tags: $tags) {
            node {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          id: `gid://shopify/Order/${orderId}`,
          tags: tagsToRemove,
        },
      }
    );
    const removeData = await removeResponse.json();
    if (removeData.data?.tagsRemove?.userErrors?.length > 0) {
      console.error("[TAG_SERVICE] Error removing order tags:", removeData.data.tagsRemove.userErrors);
    }
  }

  return { success: true, tagsAdded: tagsToAdd, tagsRemoved: tagsToRemove };
}

export async function sendVipDiscount(admin: any, storeId: string, customerId: string, email: string) {
  try {
    const store = await db.store.findUnique({ where: { id: storeId } });
    if (!store || store.planName === "Free" || store.planName === "") {
      console.log(`[SKIPPED] Cannot generate VIP discount for ${email} - Store requires Pro/Elite plan.`);
      return false;
    }

    const discountCode = `VIP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // 1. Create the Discount Code (this automatically creates the underlying rule logic in modern API)
    const discountResponse = await admin.graphql(
      `#graphql
        mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode {
              id
              codeDiscount {
                ... on DiscountCodeBasic {
                  codes(first: 1) {
                    nodes {
                      code
                    }
                  }
                }
              }
            }
            userErrors {
              field
              code
              message
            }
          }
        }
      `,
      {
        variables: {
          basicCodeDiscount: {
            title: discountCode,
            code: discountCode,
            startsAt: new Date().toISOString(),
            customerSelection: {
              customers: {
                add: [`gid://shopify/Customer/${customerId}`]
              }
            },
            customerGets: {
              value: {
                percentage: 0.2
              },
              items: {
                all: true
              }
            },
            appliesOncePerCustomer: true
          }
        }
      }
    );

    const discountData = await discountResponse.json();

    if (discountData.data?.discountCodeBasicCreate?.userErrors?.length > 0) {
      console.error("[TAG_SERVICE] Failed to create discount code:", discountData.data.discountCodeBasicCreate.userErrors);
      return false;
    }

    // 2. Simulate Email Delivery Notification
    console.log(`[EMAIL DISPATCH] Sending 20% VIP discount code ${discountCode} to ${email}`);

    // 3. Log the action in our database
    await db.activityLog.create({
      data: {
        storeId,
        customerId,
        action: "DISCOUNT_SENT",
        tagContext: "VIP",
        reason: `Generated unique 20% OFF code: ${discountCode}`
      }
    });

    return true;
  } catch (error) {
    console.error("[TAG_SERVICE] Unhandled error generating VIP discount:", error);
    return false;
  }
}
