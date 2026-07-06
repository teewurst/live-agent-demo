export type KnowledgeDocument = {
  id: string;
  topicGroup: string;
  title: string;
  content: string;
  tags: string[];
};

/**
 * Public knowledge only — no customer accounts, credentials, or personal contact data.
 */
export const PUBLIC_KNOWLEDGE_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: "prod-overview",
    topicGroup: "products",
    title: "Nexus ERP platform overview",
    content:
      "Nexus ERP is a cloud SaaS ERP suite for small and mid-sized businesses. Core modules include Finance, HR & Payroll, Inventory, CRM, and Projects. " +
      "All modules share one tenant database and are billed monthly per active user.",
    tags: ["erp", "saas", "modules", "overview"],
  },
  {
    id: "prod-finance",
    topicGroup: "products",
    title: "Finance module",
    content:
      "The Finance module covers general ledger, accounts payable and receivable, tax reporting, and bank reconciliation. " +
      "It integrates with Inventory for cost of goods and with Projects for project billing.",
    tags: ["finance", "accounting", "ledger", "module"],
  },
  {
    id: "prod-hr",
    topicGroup: "products",
    title: "HR & Payroll module",
    content:
      "HR & Payroll manages employee records, absence, payroll runs, and statutory reports. " +
      "Payroll is available in Germany (DE) and Austria (AT) locales.",
    tags: ["hr", "payroll", "employees", "module"],
  },
  {
    id: "prod-inventory",
    topicGroup: "products",
    title: "Inventory module",
    content:
      "Inventory handles warehouses, stock levels, purchase orders, and goods receipts. " +
      "Barcode scanning is supported on Professional and Enterprise plans.",
    tags: ["inventory", "warehouse", "stock", "module"],
  },
  {
    id: "plan-starter",
    topicGroup: "subscription_plans",
    title: "Starter plan",
    content:
      "Starter is for teams up to 5 licensed users. Includes Finance and CRM modules. " +
      "Monthly billing per user. Email support only. 14-day free trial available.",
    tags: ["starter", "plan", "pricing", "users", "trial"],
  },
  {
    id: "plan-professional",
    topicGroup: "subscription_plans",
    title: "Professional plan",
    content:
      "Professional supports up to 25 licensed users. All standard modules included. " +
      "Phone support during business hours. Advanced reporting and API access included.",
    tags: ["professional", "plan", "pricing", "users", "api"],
  },
  {
    id: "plan-enterprise",
    topicGroup: "subscription_plans",
    title: "Enterprise plan",
    content:
      "Enterprise has unlimited licensed users with volume discounts. Dedicated success manager, " +
      "SSO/SAML, custom SLA, and optional on-premise hybrid connector.",
    tags: ["enterprise", "plan", "sso", "sla", "unlimited"],
  },
  {
    id: "plan-trial",
    topicGroup: "subscription_plans",
    title: "Trial subscription",
    content:
      "New accounts start on a 14-day trial with up to 3 users and Finance + CRM modules. " +
      "No credit card required. After trial, choose Starter, Professional, or Enterprise.",
    tags: ["trial", "signup", "onboarding"],
  },
  {
    id: "billing-monthly",
    topicGroup: "billing_guidelines",
    title: "Monthly user-based billing",
    content:
      "Nexus ERP bills monthly in arrears based on licensed users per module. " +
      "Each invoice lists billed users, price per user, and module line items. " +
      "Adding users mid-cycle is prorated on the next invoice.",
    tags: ["billing", "monthly", "users", "invoice", "proration"],
  },
  {
    id: "billing-payment",
    topicGroup: "billing_guidelines",
    title: "Payment methods and due dates",
    content:
      "Invoices are due 14 days after issue date. Payment via SEPA direct debit or bank transfer. " +
      "Payment status is visible in the customer billing portal.",
    tags: ["payment", "sepa", "due date", "portal"],
  },
  {
    id: "support-hours",
    topicGroup: "support",
    title: "Support hours",
    content:
      "Phone support: Monday–Friday 8:00–18:00 Europe/Berlin. " +
      "Starter: email only. Professional and Enterprise: phone and email. " +
      "Outside hours use the billing portal or email support@nexus-erp.example.",
    tags: ["support", "hours", "phone", "email"],
  },
  {
    id: "faq-customer-number",
    topicGroup: "faq",
    title: "Where to find your customer number",
    content:
      "Your five-digit customer number appears on every Nexus ERP invoice PDF and in the billing portal under Account → Profile. " +
      "You need it for phone support verification.",
    tags: ["customer number", "invoice", "portal", "faq"],
  },
  {
    id: "faq-phone-password",
    topicGroup: "faq",
    title: "Phone support password",
    content:
      "Each account has a phone support password set at onboarding. " +
      "View or reset it in the billing portal under Account → Security → Phone support password. " +
      "Support never reads the password back to you on a call.",
    tags: ["password", "verification", "security", "faq"],
  },
  {
    id: "faq-verification",
    topicGroup: "faq",
    title: "Why phone verification is required",
    content:
      "Before accessing account-specific data (invoices, subscription details), support must verify your identity. " +
      "Preferred: customer number plus phone password. Alternative: customer number plus full name and date of birth.",
    tags: ["verification", "security", "faq"],
  },
  {
    id: "guideline-data-privacy",
    topicGroup: "guidelines",
    title: "Data hosting and privacy",
    content:
      "Production data is hosted in EU (Frankfurt). Encryption at rest and in transit (TLS 1.3). " +
      "GDPR-compliant DPA available for all paid plans. Public documentation does not contain tenant-specific data.",
    tags: ["gdpr", "privacy", "hosting", "security"],
  },
  {
    id: "guideline-user-licensing",
    topicGroup: "guidelines",
    title: "User licensing rules",
    content:
      "A licensed user is any account that can log in. Read-only portal users for billing contacts do not count toward ERP licenses. " +
      "Deactivate users in Admin → Users before month-end to avoid billing for the next cycle.",
    tags: ["licensing", "users", "admin", "guidelines"],
  },
  {
    id: "guideline-module-add",
    topicGroup: "guidelines",
    title: "Adding modules mid-subscription",
    content:
      "Additional modules can be enabled in the billing portal or by support. " +
      "Module fees are prorated for the current month and appear as separate line items on the next invoice.",
    tags: ["modules", "upgrade", "billing", "guidelines"],
  },

  // --- onboarding ---
  {
    id: "onboard-getting-started",
    topicGroup: "onboarding",
    title: "Getting started after signup",
    content:
      "After signup you land in the Nexus ERP setup wizard. Complete company profile, fiscal year, and base currency. " +
      "The wizard takes about 15 minutes. You can skip steps and return later under Admin → Setup.",
    tags: ["onboarding", "wizard", "setup", "signup"],
  },
  {
    id: "onboard-tenant",
    topicGroup: "onboarding",
    title: "Creating your tenant and company profile",
    content:
      "Each customer account is one tenant with isolated data. The company profile includes legal name, address, tax ID, and default cost center. " +
      "Only tenant admins can edit the company profile after initial setup.",
    tags: ["tenant", "company", "profile", "onboarding"],
  },
  {
    id: "onboard-invite-users",
    topicGroup: "onboarding",
    title: "Inviting your first users",
    content:
      "Admins invite users under Admin → Users → Invite. Each invitee receives an email link valid 7 days. " +
      "Assign roles (Admin, Accountant, HR, Read-only) before sending. Invited users count toward licensed users once they accept.",
    tags: ["users", "invite", "roles", "onboarding"],
  },

  // --- integrations ---
  {
    id: "integ-api",
    topicGroup: "integrations",
    title: "REST API overview and rate limits",
    content:
      "Professional and Enterprise plans include REST API access. Rate limit: 600 requests per minute per API key. " +
      "OpenAPI documentation is at docs.nexus-erp.example/api. API keys are created in Admin → Integrations → API keys.",
    tags: ["api", "rest", "rate limit", "integrations"],
  },
  {
    id: "integ-webhooks",
    topicGroup: "integrations",
    title: "Webhooks",
    content:
      "Webhooks notify external systems on events such as invoice.created, user.added, or payment.received. " +
      "Configure endpoints in Admin → Integrations → Webhooks. Payloads are signed with HMAC-SHA256.",
    tags: ["webhooks", "events", "integrations"],
  },
  {
    id: "integ-datev",
    topicGroup: "integrations",
    title: "DATEV export",
    content:
      "Finance module supports DATEV ASCII export for German accountants. Available on Professional and Enterprise. " +
      "Export runs from Finance → Period close → DATEV export. Consultant number and client number must be configured once.",
    tags: ["datev", "export", "finance", "germany", "integrations"],
  },
  {
    id: "integ-sso",
    topicGroup: "integrations",
    title: "SSO and SAML setup",
    content:
      "Enterprise plans support SSO via SAML 2.0 (Azure AD, Okta, Google Workspace). " +
      "Setup is self-service in Admin → Security → SSO. Metadata URL and attribute mapping are documented in the admin guide.",
    tags: ["sso", "saml", "enterprise", "integrations"],
  },

  // --- compliance ---
  {
    id: "comp-retention",
    topicGroup: "compliance",
    title: "Data retention periods",
    content:
      "Transactional ERP data is retained for the subscription term plus 90 days after cancellation. " +
      "Audit logs are kept 10 years for Finance and HR modules (German commercial law). Backups rotate daily with 35-day retention.",
    tags: ["retention", "backup", "compliance", "gdpr"],
  },
  {
    id: "comp-gobd",
    topicGroup: "compliance",
    title: "GoBD compliance notes",
    content:
      "Nexus ERP Finance supports GoBD principles: immutable posting logs, audit trail on journal entries, and exportable change history. " +
      "Customers remain responsible for proper internal controls and period archiving.",
    tags: ["gobd", "audit", "finance", "germany", "compliance"],
  },
  {
    id: "comp-dpa",
    topicGroup: "compliance",
    title: "Data processing agreement (DPA)",
    content:
      "A GDPR-compliant Data Processing Agreement (AV-Vertrag) is included with all paid plans. " +
      "Download the standard DPA from the billing portal under Legal → DPA. Enterprise customers may request custom DPA amendments.",
    tags: ["dpa", "av-vertrag", "gdpr", "compliance"],
  },

  // --- sla_incidents ---
  {
    id: "sla-status",
    topicGroup: "sla_incidents",
    title: "Status page and maintenance windows",
    content:
      "System status is published at status.nexus-erp.example. Planned maintenance is announced at least 72 hours in advance, " +
      "usually Sundays 02:00–06:00 Europe/Berlin. Enterprise SLAs define uptime targets of 99.9%.",
    tags: ["status", "maintenance", "sla", "uptime"],
  },
  {
    id: "sla-incident",
    topicGroup: "sla_incidents",
    title: "Reporting an incident or outage",
    content:
      "If the status page shows no incident but you cannot log in, email urgent@nexus-erp.example or call support during business hours. " +
      "Enterprise customers have a dedicated incident hotline number in their welcome pack.",
    tags: ["incident", "outage", "support", "sla"],
  },

  // --- upgrades_downgrades ---
  {
    id: "upg-plan-change",
    topicGroup: "upgrades_downgrades",
    title: "Plan upgrades and downgrades",
    content:
      "Upgrade from Starter to Professional or Enterprise anytime in the billing portal; changes apply immediately with prorated billing. " +
      "Downgrades take effect at the next billing cycle. Reducing licensed users below current active users requires deactivating users first.",
    tags: ["upgrade", "downgrade", "plan", "billing"],
  },
  {
    id: "upg-cancellation",
    topicGroup: "upgrades_downgrades",
    title: "Cancellation notice period",
    content:
      "Monthly subscriptions can be cancelled with 30 days notice to month-end via the billing portal. " +
      "Annual contracts require written notice 90 days before renewal. Access continues until the paid period ends.",
    tags: ["cancellation", "notice", "contract", "billing"],
  },
  {
    id: "upg-export",
    topicGroup: "upgrades_downgrades",
    title: "Data export when leaving Nexus ERP",
    content:
      "Before cancellation you can export master data, open transactions, and attachments as CSV or ZIP from Admin → Data export. " +
      "Exports are available for 90 days after subscription ends via a read-only portal login.",
    tags: ["export", "migration", "cancellation", "data"],
  },

  // --- localization ---
  {
    id: "loc-languages",
    topicGroup: "localization",
    title: "Languages and UI locales",
    content:
      "Nexus ERP UI is available in German, English, and French. Each user sets their language under Profile → Preferences. " +
      "Payroll statutory forms follow the locale of the legal entity (DE or AT), not the UI language.",
    tags: ["language", "locale", "ui", "localization"],
  },
  {
    id: "loc-currency-tax",
    topicGroup: "localization",
    title: "Currencies and tax locales",
    content:
      "Base currency is set at tenant creation (EUR default). Foreign currency transactions are supported in Finance with daily ECB rates. " +
      "Tax locales: Germany (USt), Austria (USt), and EU OSS for cross-border B2C. VAT IDs are validated via VIES.",
    tags: ["currency", "tax", "vat", "eur", "localization"],
  },

  // --- security_public ---
  {
    id: "sec-2fa",
    topicGroup: "security_public",
    title: "Two-factor authentication for the portal",
    content:
      "All users can enable TOTP 2FA in Profile → Security → Two-factor authentication. " +
      "Admins can enforce 2FA for all users under Admin → Security → Policies. Backup codes are provided once at setup.",
    tags: ["2fa", "totp", "security", "portal"],
  },
  {
    id: "sec-password-policy",
    topicGroup: "security_public",
    title: "Password policy",
    content:
      "Passwords must be at least 12 characters with upper, lower, and numeric characters. " +
      "Passwords expire after 180 days unless SSO is used. Failed login lockout after 5 attempts for 15 minutes.",
    tags: ["password", "policy", "security", "lockout"],
  },

  // --- partner_reseller ---
  {
    id: "partner-program",
    topicGroup: "partner_reseller",
    title: "Partner program overview",
    content:
      "Nexus ERP partners include implementation consultants and resellers. Partners receive a sandbox tenant, training access, and co-marketing materials. " +
      "Apply at partners.nexus-erp.example. Partner tier depends on certified consultants and annual revenue.",
    tags: ["partner", "reseller", "program"],
  },
  {
    id: "partner-discounts",
    topicGroup: "partner_reseller",
    title: "Reseller discounts and billing",
    content:
      "Registered resellers receive 15–25% recurring discount depending on tier. End customers are billed through the partner account or direct with partner referral code. " +
      "Discount details are in the partner portal — not disclosed on public pricing pages.",
    tags: ["reseller", "discount", "partner", "billing"],
  },
];
