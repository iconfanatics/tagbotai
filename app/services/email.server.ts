/**
 * Email Service Module
 * Handles outward bound transactional emails to merchants.
 */
export async function sendWelcomeEmail(shopName: string, recipientEmail: string) {
    const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
            <h1 style="color: #00A0AC;">Welcome to TagBot AI! 🎉</h1>
            <p>Hi ${shopName},</p>
            <p>Thank you for installing <strong>TagBot AI: Smart Segmentation</strong>. We are thrilled to have you onboard.</p>
            <p>Here’s a quick guide to getting the most out of our automation engine:</p>
            <ul>
                <li><strong>Recover At-Risk VIPs:</strong> Use our AI Insight dashboard to instantly find your highest-spending customers who haven't ordered recently.</li>
                <li><strong>Automate Your Workflows:</strong> Create rules to auto-tag Big Spenders, Loyalists, and Window Shoppers instantly when they buy.</li>
                <li><strong>Export and Target:</strong> Push your segmented lists directly into your email platform for highly targeted campaigns.</li>
            </ul>
            <p>Need help setting up your first rule? <a href="mailto:support@tagbotai.com" style="color: #00A0AC; font-weight: bold;">Reply to this email</a> and our human support team will jump in.</p>
            <br/>
            <p>To your growth,</p>
            <p><strong>The TagBot AI Team</strong></p>
        </div>
    `;

    console.log(`\n=================================================`);
    console.log(`[EMAIL DISPATCHER] -> Simulated Welcome Email Sent!`);
    console.log(`To: ${recipientEmail}`);
    console.log(`Subject: Welcome to TagBot AI! Let's boost your sales 🚀`);
    console.log(`\n${htmlBody}`);
    console.log(`=================================================\n`);

    // TODO: In production, integrate SendGrid, Resend, or AWS SES here.
    return true;
}
