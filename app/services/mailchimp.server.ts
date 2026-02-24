import crypto from 'crypto';

export async function syncTagsToMailchimp(apiKey: string, serverPrefix: string, listId: string, email: string, tagsToAdd: string[]) {
    if (!apiKey || !serverPrefix || !listId || !email || tagsToAdd.length === 0) {
        return { success: false, message: "Missing required Mailchimp Sync parameters." };
    }

    try {
        console.log(`[MAILCHIMP SYNC API] Syncing tags for ${email} to Audience ${listId}`);

        // Why: Mailchimp strictly identifies subscribers by the MD5 hash of their lowercase email.
        const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');

        const baseUrl = `https://${serverPrefix}.api.mailchimp.com/3.0`;
        const endpoint = `/lists/${listId}/members/${subscriberHash}/tags`;

        // Mailchimp Tags API requires an array of objects: { name: "Tag Name", status: "active" | "inactive" }
        const tagsPayload = {
            tags: tagsToAdd.map(tag => ({
                name: tag,
                status: "active"
            }))
        };

        const response = await fetch(`${baseUrl}${endpoint}`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(tagsPayload)
        });

        if (response.ok) {
            console.log(`[MAILCHIMP SYNC API] Successfully applied tags [${tagsToAdd.join(", ")}] to Mailchimp profile for ${email}`);
            return { success: true };
        } else {
            const errorText = await response.text();

            // If the user doesn't exist in the list yet, Mailchimp returns a 404 on the tags endpoint.
            // A more robust implementation would catch the 404, trigger a member CREATE endpoint, and then apply the tags.
            if (response.status === 404) {
                console.log(`[MAILCHIMP SYNC API] Profile ${email} not found in Audience ${listId}. Skipping tag sync.`);
                return { success: true, message: "Profile not found in Audience." };
            }

            console.error(`[MAILCHIMP_SERVICE] Failed to apply tags. Response: ${response.status} - ${errorText}`);
            return { success: false, message: "Failed to apply tags to Mailchimp." };
        }

    } catch (err: any) {
        console.error(`[MAILCHIMP_SERVICE] Unhandled exception during sync for ${email}:`, err);
        return { success: false, message: err.message || "Unknown Mailchimp Sync Error" };
    }
}
