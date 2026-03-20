import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function run() {
  const store = await db.store.findFirst({
    where: { klaviyoIsActive: true, klaviyoAccessToken: { not: null } }
  });
  
  if (!store) {
    console.log("No store with klaviyoAccessToken found.");
    return;
  }
  
  const accessToken = store.klaviyoAccessToken;
  console.log("Found token:", accessToken?.substring(0, 10) + "...");
  
  const email = "test@example.com";
  const tagsToAdd = ["TestTag"];
  
  const payload = {
    data: {
      type: "profile",
      attributes: {
        email: email,
        properties: {
          "TagBot_Segments": tagsToAdd.join(", ")
        }
      }
    }
  };

  const response = await fetch(`https://a.klaviyo.com/api/profile-import/`, {
    method: 'POST',
    headers: {
      'Revision': "2024-02-15",
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  console.log("Status:", response.status);
  console.log("Body:", await response.text());
}
run();
