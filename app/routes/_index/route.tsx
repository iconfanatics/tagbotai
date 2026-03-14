import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData, Link } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function LandingPage() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.container}>
          <div className={styles.badge}>Powered by iConfanatics AI</div>
          <h1 className={styles.heading}>
            Supercharge Your <br />
            Klaviyo Growth with AI
          </h1>
          <p className={styles.text}>
            TagBot AI automatically segments your Shopify customers and orders using 
            intelligent rules, syncing real-time data to Klaviyo for 
            highly-targeted marketing that converts.
          </p>

          {showForm && (
            <div className={styles.formWrapper}>
              <span className={styles.formTitle}>Install TagBot AI on your store</span>
              <Form className={styles.form} method="post" action="/auth/login">
                <div className={styles.label}>
                  <input 
                    className={styles.input} 
                    type="text" 
                    name="shop" 
                    placeholder="my-store.myshopify.com"
                    required
                  />
                  <span className={styles.hint}>Enter your .myshopify.com domain</span>
                </div>
                <button className={styles.button} type="submit">
                  Get Started Free
                </button>
              </Form>
            </div>
          )}
        </div>
      </section>

      {/* Features Grid */}
      <section className={styles.features}>
        <div className={styles.container}>
          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardIcon}>🧠</div>
              <h3 className={styles.cardTitle}>AI-Driven Logic</h3>
              <p className={styles.cardText}>
                Use natural language to create complex rules. Our AI understands 
                high-value patterns like "Churn Risk" or "VIP Whale" automatically.
              </p>
            </div>
            <div className={styles.card}>
              <div className={styles.cardIcon}>⚡</div>
              <h3 className={styles.cardTitle}>Real-Time Sync</h3>
              <p className={styles.cardText}>
                The moment a customer qualifies for a tag, it's pushed to Klaviyo. 
                Keep your flows up to date with zero latency.
              </p>
            </div>
            <div className={styles.card}>
              <div className={styles.cardIcon}>🚀</div>
              <h3 className={styles.cardTitle}>ROI Tracking</h3>
              <p className={styles.cardText}>
                See exactly how much revenue your segments are generating. 
                Make data-backed decisions to scale your best channels.
              </p>
            </div>
            <div className={styles.card}>
              <div className={styles.cardIcon}>📂</div>
              <h3 className={styles.cardTitle}>Historical Bulk Sync</h3>
              <p className={styles.cardText}>
                Instantly process your entire store history. Perfect for 
                kickstarting retention campaigns for past buyers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerLinks}>
            <Link to="/privacy" className={styles.footerLink}>Privacy Policy</Link>
            <Link to="/terms" className={styles.footerLink}>Terms of Service</Link>
            <Link to="/klaviyo/instructions" className={styles.footerLink}>Klaviyo Review Instructions</Link>
            <a href="mailto:xhtmlcrew@gmail.com" className={styles.footerLink}>Support</a>
          </div>
          <p className={styles.copyright}>
            © {new Date().getFullYear()} iConfanatics. All rights reserved. 
            TagBot AI is a Shopify Partner App.
          </p>
        </div>
      </footer>
    </div>
  );
}
