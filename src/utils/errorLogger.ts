// Never serialize the original error: Prisma/OAuth errors can contain credentials,
// authorization codes, request bodies and personal data.
const databaseReasons: Record<string, string> = {
  P1000: "database_authentication_failed",
  P1001: "database_unreachable",
  P1002: "database_connection_timeout",
  P1003: "database_not_found",
  P1010: "database_access_denied",
  P1011: "database_tls_error",
  P1012: "database_configuration_invalid",
  P1013: "database_url_invalid",
  P2021: "database_table_missing",
  P2022: "database_column_missing",
  P2024: "database_pool_timeout",
};

export function errorSummary(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawCode = value.errorCode ?? value.code;
  const code = typeof rawCode === "string" && /^P\d{4}$/.test(rawCode) ? rawCode : undefined;
  const name = typeof value.name === "string" && /^PrismaClient\w*Error$/.test(value.name)
    ? value.name : "Error";
  return { type: name, code, reason: code ? databaseReasons[code] ?? "database_request_failed" : "unclassified_error" };
}

export function logServerError(event: string, error: unknown) {
  console.error(JSON.stringify({ event, ...errorSummary(error) }));
}
