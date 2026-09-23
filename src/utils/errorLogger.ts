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

function initializationReason(message: unknown): string {
  if (typeof message !== "string") return "unclassified_error";
  // Match known descriptions but never emit the original text or captured values.
  const patterns: [RegExp, string][] = [
    [/Can't reach database server|ECONNREFUSED|ENOTFOUND/i, "database_unreachable"],
    [/Authentication failed|Access denied for user/i, "database_authentication_failed"],
    [/Environment variable not found.*DATABASE_URL/i, "database_url_missing"],
    [/connection string is invalid|URL must start with|invalid.*database.*url/i, "database_url_invalid"],
    [/Query Engine|query engine|libquery_engine|libssl|OpenSSL/i, "database_engine_runtime_error"],
    [/TLS|SSL connection|certificate/i, "database_tls_error"],
    [/timed out|timeout/i, "database_connection_timeout"],
    [/does not exist.*database|Unknown database/i, "database_not_found"],
  ];
  return patterns.find(([pattern]) => pattern.test(message))?.[1] ?? "unclassified_error";
}

export function databaseConfigSummary(value: string | undefined) {
  if (!value) return { configured: false };
  try {
    const url = new URL(value);
    return { configured: true, validUrl: true, mysql: url.protocol === "mysql:",
      loopback: ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname),
      databaseSelected: url.pathname.length > 1 };
  } catch { return { configured: true, validUrl: false }; }
}

export function errorSummary(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawCode = value.errorCode ?? value.code;
  const code = typeof rawCode === "string" && /^P\d{4}$/.test(rawCode) ? rawCode : undefined;
  const name = typeof value.name === "string" && /^PrismaClient\w*Error$/.test(value.name)
    ? value.name : "Error";
  return { type: name, code, reason: code ? databaseReasons[code] ?? "database_request_failed" : name === "PrismaClientInitializationError" ? initializationReason(value.message) : "unclassified_error" };
}

export function logServerError(event: string, error: unknown) {
  console.error(JSON.stringify({ event, ...errorSummary(error) }));
}
