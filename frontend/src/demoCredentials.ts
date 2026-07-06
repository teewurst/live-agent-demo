/** Demo lookup data shown in the UI — must match backend demo records. */
export const DEMO_CUSTOMERS = [
  {
    customerNumber: "12345",
    phonePassword: "9876",
    fullName: "Maria Schneider",
    birthDate: "1985-03-12",
    note: "Primary demo account",
  },
  {
    customerNumber: "67890",
    phonePassword: "horizon42",
    fullName: "Thomas Weber",
    birthDate: "1978-11-04",
    note: "Second demo account",
  },
] as const;

export const PRIMARY_DEMO_CUSTOMER = DEMO_CUSTOMERS[0];
