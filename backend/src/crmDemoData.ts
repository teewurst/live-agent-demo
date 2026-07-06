export type ValidateAuthMethod = "phone_password" | "name_birthdate";

export type SubscriptionTier = "trial" | "starter" | "professional" | "enterprise";

export type CustomerInfoLookup =
  | "account_profile"
  | "subscription_details"
  | "latest_invoice"
  | "invoice_by_id"
  | "list_invoices"
  | "open_invoices"
  | "overdue_invoices"
  | "billing_contact";

/** @deprecated use CUSTOMER_INFO_LOOKUPS */
export type ResearchLookup = CustomerInfoLookup;

export const VALIDATE_AUTH_METHODS = ["phone_password", "name_birthdate"] as const;

export const CUSTOMER_INFO_LOOKUPS = [
  "account_profile",
  "subscription_details",
  "latest_invoice",
  "invoice_by_id",
  "list_invoices",
  "open_invoices",
  "overdue_invoices",
  "billing_contact",
] as const;

/** @deprecated use CUSTOMER_INFO_LOOKUPS */
export const RESEARCH_LOOKUPS = CUSTOMER_INFO_LOOKUPS;

export type InvoiceStatus = "open" | "paid" | "overdue";

export type InvoiceLineItem = {
  module: string;
  licensedUsers: number;
  pricePerUser: number;
  amount: number;
};

export type InvoiceRecord = {
  invoiceId: string;
  issueDate: string;
  dueDate: string;
  billingPeriod: string;
  status: InvoiceStatus;
  amount: number;
  currency: "EUR";
  description: string;
  subscriptionTier: SubscriptionTier;
  licensedUsers: number;
  billedUsers: number;
  pricePerUser: number;
  lineItems: InvoiceLineItem[];
  paidDate?: string;
};

export type BillingContact = {
  name: string;
  email: string;
  phone: string;
};

export type DemoCustomerRecord = {
  customerNumber: string;
  phonePassword: string;
  fullName: string;
  birthDate: string;
  companyName: string;
  subscriptionTier: SubscriptionTier;
  licensedUsers: number;
  activeUsers: number;
  billingCycle: "monthly";
  contractStartDate: string;
  billingContact: BillingContact;
  invoices: InvoiceRecord[];
};

const DEMO_CUSTOMERS: DemoCustomerRecord[] = [
  {
    customerNumber: "12345",
    phonePassword: "9876",
    fullName: "Maria Schneider",
    birthDate: "1985-03-12",
    companyName: "Schneider Logistik GmbH",
    subscriptionTier: "professional",
    licensedUsers: 18,
    activeUsers: 16,
    billingCycle: "monthly",
    contractStartDate: "2024-06-01",
    billingContact: {
      name: "Maria Schneider",
      email: "billing@schneider-logistik.example",
      phone: "+49 30 12345678",
    },
    invoices: [
      {
        invoiceId: "INV-12345-2026-004",
        issueDate: "2026-03-01",
        dueDate: "2026-03-15",
        billingPeriod: "2026-03",
        status: "open",
        amount: 1242.0,
        currency: "EUR",
        description: "Nexus ERP — March 2026 (18 users)",
        subscriptionTier: "professional",
        licensedUsers: 18,
        billedUsers: 18,
        pricePerUser: 69.0,
        lineItems: [
          { module: "Finance", licensedUsers: 18, pricePerUser: 29.0, amount: 522.0 },
          { module: "HR & Payroll", licensedUsers: 12, pricePerUser: 24.0, amount: 288.0 },
          { module: "Inventory", licensedUsers: 8, pricePerUser: 16.0, amount: 128.0 },
          { module: "CRM", licensedUsers: 18, pricePerUser: 17.0, amount: 304.0 },
        ],
      },
      {
        invoiceId: "INV-12345-2026-003",
        issueDate: "2026-02-01",
        dueDate: "2026-02-15",
        billingPeriod: "2026-02",
        status: "paid",
        amount: 1173.0,
        currency: "EUR",
        description: "Nexus ERP — February 2026 (17 users)",
        subscriptionTier: "professional",
        licensedUsers: 17,
        billedUsers: 17,
        pricePerUser: 69.0,
        lineItems: [
          { module: "Finance", licensedUsers: 17, pricePerUser: 29.0, amount: 493.0 },
          { module: "HR & Payroll", licensedUsers: 12, pricePerUser: 24.0, amount: 288.0 },
          { module: "Inventory", licensedUsers: 8, pricePerUser: 16.0, amount: 128.0 },
          { module: "CRM", licensedUsers: 17, pricePerUser: 17.0, amount: 264.0 },
        ],
        paidDate: "2026-02-10",
      },
      {
        invoiceId: "INV-12345-2025-012",
        issueDate: "2025-12-01",
        dueDate: "2025-12-15",
        billingPeriod: "2025-12",
        status: "overdue",
        amount: 384.0,
        currency: "EUR",
        description: "Nexus ERP Projects add-on — December 2025",
        subscriptionTier: "professional",
        licensedUsers: 16,
        billedUsers: 16,
        pricePerUser: 24.0,
        lineItems: [{ module: "Projects", licensedUsers: 16, pricePerUser: 24.0, amount: 384.0 }],
      },
    ],
  },
  {
    customerNumber: "67890",
    phonePassword: "horizon42",
    fullName: "Thomas Weber",
    birthDate: "1978-11-04",
    companyName: "Weber Consulting AG",
    subscriptionTier: "enterprise",
    licensedUsers: 42,
    activeUsers: 39,
    billingCycle: "monthly",
    contractStartDate: "2023-01-15",
    billingContact: {
      name: "Thomas Weber",
      email: "finance@weber-consulting.example",
      phone: "+49 89 99887766",
    },
    invoices: [
      {
        invoiceId: "INV-67890-2026-002",
        issueDate: "2026-02-15",
        dueDate: "2026-03-01",
        billingPeriod: "2026-02",
        status: "open",
        amount: 2898.0,
        currency: "EUR",
        description: "Nexus ERP Enterprise — February 2026 (42 users)",
        subscriptionTier: "enterprise",
        licensedUsers: 42,
        billedUsers: 42,
        pricePerUser: 69.0,
        lineItems: [
          { module: "Finance", licensedUsers: 42, pricePerUser: 29.0, amount: 1218.0 },
          { module: "HR & Payroll", licensedUsers: 42, pricePerUser: 24.0, amount: 1008.0 },
          { module: "CRM", licensedUsers: 42, pricePerUser: 17.0, amount: 714.0 },
        ],
      },
      {
        invoiceId: "INV-67890-2026-001",
        issueDate: "2026-01-10",
        dueDate: "2026-01-24",
        billingPeriod: "2026-01",
        status: "paid",
        amount: 2829.0,
        currency: "EUR",
        description: "Nexus ERP Enterprise — January 2026 (41 users)",
        subscriptionTier: "enterprise",
        licensedUsers: 41,
        billedUsers: 41,
        pricePerUser: 69.0,
        lineItems: [
          { module: "Finance", licensedUsers: 41, pricePerUser: 29.0, amount: 1189.0 },
          { module: "HR & Payroll", licensedUsers: 41, pricePerUser: 24.0, amount: 984.0 },
          { module: "CRM", licensedUsers: 41, pricePerUser: 17.0, amount: 697.0 },
        ],
        paidDate: "2026-01-18",
      },
    ],
  },
];

export function parseDemoPasswords(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return { "12345": "9876", "67890": "horizon42" };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const map: Record<string, string> = {};
    for (const [customerNumber, password] of Object.entries(parsed)) {
      if (typeof password === "string" && customerNumber.trim()) {
        map[customerNumber.trim()] = password;
      }
    }
    return map;
  } catch {
    return {};
  }
}

export function mergeDemoPasswords(passwords: Record<string, string>): void {
  for (const customer of DEMO_CUSTOMERS) {
    const override = passwords[customer.customerNumber];
    if (override) {
      customer.phonePassword = override;
    }
  }
}

export function findCustomer(customerNumber: string): DemoCustomerRecord | undefined {
  return DEMO_CUSTOMERS.find((customer) => customer.customerNumber === customerNumber);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export type ValidateCustomerInput = {
  customer_number: string;
  auth_method: ValidateAuthMethod;
  phone_password?: string;
  full_name?: string;
  birth_date?: string;
};

export type ValidateCustomerResult = {
  valid: boolean;
  customerNumber?: string;
  authMethod?: ValidateAuthMethod;
  message?: string;
};

export function validateCustomerAuth(input: ValidateCustomerInput): ValidateCustomerResult {
  const customer = findCustomer(input.customer_number.trim());
  if (!customer) {
    return { valid: false, message: "Customer number not found." };
  }

  if (input.auth_method === "phone_password") {
    const password = input.phone_password?.trim() ?? "";
    if (!password) {
      return { valid: false, message: "phone_password is required for auth_method phone_password." };
    }
    const valid = customer.phonePassword === password;
    return {
      valid,
      customerNumber: valid ? customer.customerNumber : undefined,
      authMethod: "phone_password",
      message: valid ? undefined : "Phone password does not match.",
    };
  }

  const fullName = input.full_name?.trim() ?? "";
  const birthDate = input.birth_date?.trim() ?? "";
  if (!fullName || !birthDate) {
    return {
      valid: false,
      message: "full_name and birth_date are required for auth_method name_birthdate.",
    };
  }

  const valid =
    normalizeName(fullName) === normalizeName(customer.fullName) &&
    birthDate === customer.birthDate;

  return {
    valid,
    customerNumber: valid ? customer.customerNumber : undefined,
    authMethod: "name_birthdate",
    message: valid ? undefined : "Name and birth date do not match our records.",
  };
}

export function sanitizeAccountProfile(customer: DemoCustomerRecord): Record<string, unknown> {
  return {
    customerNumber: customer.customerNumber,
    companyName: customer.companyName,
    subscriptionTier: customer.subscriptionTier,
    licensedUsers: customer.licensedUsers,
    activeUsers: customer.activeUsers,
    billingCycle: customer.billingCycle,
    contractStartDate: customer.contractStartDate,
  };
}

export function subscriptionDetailsForTier(tier: SubscriptionTier): Record<string, unknown> {
  const catalog: Record<SubscriptionTier, Record<string, unknown>> = {
    trial: {
      tier: "trial",
      maxLicensedUsers: 3,
      modules: ["Finance", "CRM"],
      support: "email",
      billing: "free for 14 days",
    },
    starter: {
      tier: "starter",
      maxLicensedUsers: 5,
      modules: ["Finance", "CRM"],
      support: "email",
      billing: "monthly per user",
    },
    professional: {
      tier: "professional",
      maxLicensedUsers: 25,
      modules: ["Finance", "HR & Payroll", "Inventory", "CRM", "Projects"],
      support: "phone and email",
      billing: "monthly per user",
    },
    enterprise: {
      tier: "enterprise",
      maxLicensedUsers: null,
      modules: ["All modules", "SSO/SAML", "API", "Dedicated success manager"],
      support: "priority phone and email",
      billing: "monthly per user with volume discounts",
    },
  };
  return catalog[tier];
}

export type CustomerInformationInput = {
  customer_number: string;
  lookup: CustomerInfoLookup;
  invoice_id?: string;
};

function sortInvoicesNewestFirst(invoices: InvoiceRecord[]): InvoiceRecord[] {
  return [...invoices].sort((a, b) => b.issueDate.localeCompare(a.issueDate));
}

export function getCustomerInformation(input: CustomerInformationInput): Record<string, unknown> {
  const customer = findCustomer(input.customer_number.trim());
  if (!customer) {
    return {
      error: "CUSTOMER_NOT_FOUND",
      message: `No customer record for ${input.customer_number}.`,
    };
  }

  const invoices = sortInvoicesNewestFirst(customer.invoices);

  switch (input.lookup) {
    case "account_profile":
      return { lookup: input.lookup, ...sanitizeAccountProfile(customer) };
    case "subscription_details":
      return {
        lookup: input.lookup,
        customerNumber: customer.customerNumber,
        companyName: customer.companyName,
        current: {
          subscriptionTier: customer.subscriptionTier,
          licensedUsers: customer.licensedUsers,
          activeUsers: customer.activeUsers,
          billingCycle: customer.billingCycle,
        },
        planCatalog: subscriptionDetailsForTier(customer.subscriptionTier),
      };
    case "latest_invoice": {
      const latest = invoices[0];
      return latest
        ? { customerNumber: customer.customerNumber, invoice: latest }
        : { customerNumber: customer.customerNumber, invoice: null };
    }
    case "invoice_by_id": {
      const invoiceId = input.invoice_id?.trim();
      if (!invoiceId) {
        return {
          error: "MISSING_INVOICE_ID",
          message: "invoice_id is required when lookup is invoice_by_id.",
        };
      }
      const invoice = invoices.find((entry) => entry.invoiceId === invoiceId);
      return invoice
        ? { customerNumber: customer.customerNumber, invoice }
        : {
            customerNumber: customer.customerNumber,
            invoice: null,
            message: `No invoice with id ${invoiceId}.`,
          };
    }
    case "list_invoices":
      return {
        customerNumber: customer.customerNumber,
        count: invoices.length,
        invoices,
      };
    case "open_invoices":
      return {
        customerNumber: customer.customerNumber,
        count: invoices.filter((entry) => entry.status === "open").length,
        invoices: invoices.filter((entry) => entry.status === "open"),
      };
    case "overdue_invoices":
      return {
        customerNumber: customer.customerNumber,
        count: invoices.filter((entry) => entry.status === "overdue").length,
        invoices: invoices.filter((entry) => entry.status === "overdue"),
      };
    case "billing_contact":
      return {
        customerNumber: customer.customerNumber,
        billingContact: customer.billingContact,
      };
    default:
      return {
        error: "UNKNOWN_LOOKUP",
        message: `Unsupported lookup ${String(input.lookup)}.`,
      };
  }
}

/** @deprecated use getCustomerInformation */
export function researchCustomerLookup(input: CustomerInformationInput): Record<string, unknown> {
  return getCustomerInformation(input);
}

export function describeValidateArgsForGate(args: Record<string, unknown>): string | null {
  const customerNumber = typeof args.customer_number === "string" ? args.customer_number.trim() : "";
  const authMethod = args.auth_method;
  if (!customerNumber || isPlaceholder(customerNumber)) {
    return "customer_number";
  }
  if (authMethod !== "phone_password" && authMethod !== "name_birthdate") {
    return "auth_method";
  }
  if (authMethod === "phone_password") {
    const password = typeof args.phone_password === "string" ? args.phone_password.trim() : "";
    if (!password || isPlaceholder(password)) {
      return "phone_password";
    }
  }
  if (authMethod === "name_birthdate") {
    const fullName = typeof args.full_name === "string" ? args.full_name.trim() : "";
    const birthDate = typeof args.birth_date === "string" ? args.birth_date.trim() : "";
    if (!fullName || isPlaceholder(fullName)) {
      return "full_name";
    }
    if (!birthDate || isPlaceholder(birthDate)) {
      return "birth_date";
    }
  }
  return null;
}

export function describeCustomerInfoArgsForGate(args: Record<string, unknown>): string | null {
  const lookup = args.lookup;
  if (!lookup || !CUSTOMER_INFO_LOOKUPS.includes(lookup as CustomerInfoLookup)) {
    return "lookup";
  }
  if (lookup === "invoice_by_id") {
    const invoiceId = typeof args.invoice_id === "string" ? args.invoice_id.trim() : "";
    if (!invoiceId || isPlaceholder(invoiceId)) {
      return "invoice_id";
    }
  }
  return null;
}

/** @deprecated use describeCustomerInfoArgsForGate */
export function describeResearchArgsForGate(args: Record<string, unknown>): string | null {
  return describeCustomerInfoArgsForGate(args);
}

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized === "unknown" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "?" ||
    normalized === "tbd"
  );
}
