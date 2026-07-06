import {
  CUSTOMER_INFO_LOOKUPS,
  getCustomerInformation,
  validateCustomerAuth,
  type CustomerInfoLookup,
  type ValidateCustomerInput,
  VALIDATE_AUTH_METHODS,
  mergeDemoPasswords,
} from "./crmDemoData.js";
import { retrieveInformation } from "./knowledge/retrieveInformation.js";
import { config } from "./config.js";

mergeDemoPasswords(config.DEMO_CUSTOMER_PASSWORDS);

export { VALIDATE_AUTH_METHODS, CUSTOMER_INFO_LOOKUPS };
export type { ValidateCustomerInput, CustomerInfoLookup };

export function localValidateCustomer(input: ValidateCustomerInput) {
  return validateCustomerAuth(input);
}

export function localGetCustomerInformation(
  customerNumber: string,
  lookup: CustomerInfoLookup,
  invoiceId?: string,
) {
  return getCustomerInformation({
    customer_number: customerNumber,
    lookup,
    invoice_id: invoiceId,
  });
}

export function localRetrieveInformation(
  query: string,
  topicGroup?: string,
  maxResults?: number,
) {
  return retrieveInformation({
    query,
    topic_group: topicGroup,
    max_results: maxResults,
  });
}

/** @deprecated use localGetCustomerInformation */
export function localResearchCustomer(
  customerNumber: string,
  lookup: CustomerInfoLookup,
  invoiceId?: string,
) {
  return localGetCustomerInformation(customerNumber, lookup, invoiceId);
}
