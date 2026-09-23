import app from "./app";
import { config } from "./config";
import { prisma } from "./utils/prisma";
import { databaseConfigSummary, logServerError } from "./utils/errorLogger";

app.listen(config.port, () => {
  console.log(`Backend listening on port ${config.port}`);
  console.log(JSON.stringify({ event: "database_config", ...databaseConfigSummary(process.env.DATABASE_URL) }));
  void prisma.$connect()
    .then(() => console.log(JSON.stringify({ event: "database_connected" })))
    .catch(error => logServerError("database_connection_failed", error));
});
