export async function syncTagsToKlaviyo(apiKey: string, email: string, tagsToAdd: string[]) {
    if (!apiKey || !email || tagsToAdd.length === 0) {
        return { success: false, message: "Missing required Klaviyo Sync parameters." };
    }

    try {
        console.log(`[KLAVIYO SYNC API] Searching for profile exactly matching email: ${email}`);

        // 1. Identify Profile in Klaviyo by Email
        let profileId = null;

        // Why: Klaviyo's API requires finding a profile by email first before we can mutate its properties.
        const filter = `equals(email,"${email}")`;
        const searchResponse = await fetch(`https://a.klaviyo.com/api/profiles/?filter=${encodeURIComponent(filter)}`, {
            method: 'GET',
            headers: {
                'Revision': '2024-02-15',
                'Authorization': `Klaviyo-API-Key ${apiKey}`,
                'Accept': 'application/json'
            }
        });

        if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            if (searchData.data && searchData.data.length > 0) {
                profileId = searchData.data[0].id;
                console.log(`[KLAVIYO SYNC API] Found Profile ID: ${profileId}`);
            }
        } else {
            const errorText = await searchResponse.text();
            console.error(`[KLAVIYO SYNC API] Search failed or unauthorized. Response: ${searchResponse.status} - ${errorText}`);
            return { success: false, message: "Failed to authenticate or search Klaviyo API." };
        }

        // 2. If Profile exists, append tags (as custom properties) or trigger an event
        if (profileId) {
            console.log(`[KLAVIYO SYNC API] Applying Tags: [${tagsToAdd.join(", ")}] to Profile ${profileId}`);

            // Klaviyo Profiles API: Update Profile
            // https://developers.klaviyo.com/en/reference/update_profile
            const updatePayload = {
                data: {
                    type: "profile",
                    id: profileId,
                    attributes: {
                        properties: {
                            // In a real app we might want to fetch existing tags and concatenate, 
                            // but for simplicity we will overwrite the "TagBot_Segment" property
                            // or append uniquely depending on merchant setup.
                            "TagBot_Segments": tagsToAdd.join(", ")
                        }
                    }
                }
            };

            const updateResponse = await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/`, {
                method: 'PATCH',
                headers: {
                    'Revision': '2024-02-15',
                    'Authorization': `Klaviyo-API-Key ${apiKey}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatePayload)
            });

            if (updateResponse.ok) {
                console.log(`[KLAVIYO SYNC API] Successfully updated Klaviyo profile for ${email}`);
                return { success: true };
            } else {
                const errorText = await updateResponse.text();
                console.error(`[KLAVIYO SYNC API] Failed to update profile. Response: ${updateResponse.status} - ${errorText}`);
                return { success: false, message: "Profile found, but failed to apply tags." };
            }
        } else {
            console.log(`[KLAVIYO SYNC API] No matching Klaviyo profile found for email ${email}. Skipping sync.`);
            return { success: true, message: "No profile found." };
        }

    } catch (err: any) {
        console.error(`[KLAVIYO_SERVICE] Unhandled exception during sync for ${email}:`, err);
        return { success: false, message: err.message || "Unknown Klaviyo Sync Error" };
    }
}
