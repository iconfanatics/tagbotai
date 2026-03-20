import { Resend } from 'resend';

/**
 * Email Service Module
 * Handles outward bound transactional emails to merchants.
 */

// We get the Resend instance if the API key exists
const getResendInstance = () => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return null;
    return new Resend(apiKey);
};

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
            <p>Need help setting up your first rule? <a href="mailto:tagbotai@iconfanatics.com" style="color: #00A0AC; font-weight: bold;">Reply to this email</a> and our human support team will jump in.</p>
            <br/>
            <p>To your growth,</p>
            <p><strong>The TagBot AI Team</strong></p>
        </div>
    `;

    const resend = getResendInstance();

    if (!resend) {
        console.warn(`[EMAIL WARNING] RESEND_API_KEY is not set. Simulated Welcome Email sent to ${recipientEmail}`);
        return true; // Soft fail so app installation doesn't break
    }

    try {
        await resend.emails.send({
            from: 'TagBot AI <tagbotai@iconfanatics.com>',
            to: recipientEmail,
            subject: "Welcome to TagBot AI! Let's boost your sales 🚀",
            html: htmlBody,
        });
        console.log(`[EMAIL DISPATCHER] -> Welcome Email Successfully Sent to ${recipientEmail}`);
        return true;
    } catch (error) {
        console.error(`[EMAIL ERROR] Failed to send Welcome Email:`, error);
        return false;
    }
}

export async function sendUpgradePromptEmail(shopName: string, recipientEmail: string) {
    const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
            <h1 style="color: #00A0AC;">Unlock the Full Power of TagBot AI 🚀</h1>
            <p>Hi ${shopName},</p>
            <p>You've been using TagBot AI for a week now! We hope you're already seeing the value of automated customer segmentation.</p>
            <p>Did you know you can unlock even more revenue by upgrading to our <strong>Pro Plan</strong>?</p>
            <h3>Why Upgrade to Pro?</h3>
            <ul>
                <li><strong>Unlimited Rules:</strong> Create as many automation workflows as you need without limits.</li>
                <li><strong>AI Predictive Insights:</strong> Let our AI automatically tag your At-Risk VIPs before they churn.</li>
                <li><strong>Customer Note Syncing:</strong> Automatically append rich insights directly into Shopify customer notes.</li>
            </ul>
            <p>Upgrade today directly from the Billing tab in the TagBot AI dashboard to scale your store's retention strategy.</p>
            <br/>
            <p>Cheers,</p>
            <p><strong>The TagBot AI Team</strong></p>
        </div>
    `;

    const resend = getResendInstance();

    if (!resend) {
        console.warn(`[EMAIL WARNING] RESEND_API_KEY is not set. Simulated Upgrade Prompt sent to ${recipientEmail}`);
        return true;
    }

    try {
        await resend.emails.send({
            from: 'TagBot AI <tagbotai@iconfanatics.com>',
            to: recipientEmail,
            subject: "Take your store segmentation to the next level 📈",
            html: htmlBody,
        });
        console.log(`[EMAIL DISPATCHER] -> Upgrade Prompt Email Successfully Sent to ${recipientEmail}`);
        return true;
    } catch (error) {
        console.error(`[EMAIL ERROR] Failed to send Upgrade Prompt:`, error);
        return false;
    }
}

export async function sendEmail(to: string, subject: string, htmlBody: string) {
    const resend = getResendInstance();

    if (!resend) {
        console.warn(`[EMAIL WARNING] RESEND_API_KEY is not set. Simulated outbound email sent to ${to}`);
        return true;
    }

    try {
        // For general outbound support requests, the reply-to becomes the merchant.
        await resend.emails.send({
            from: 'TagBot AI Support <tagbotai@iconfanatics.com>',
            to: to,
            subject: subject,
            html: htmlBody,
        });
        return true;
    } catch (error) {
        console.error(`[EMAIL ERROR] Failed to send standard email:`, error);
        return false;
    }
}
