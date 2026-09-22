import app from "./app";
import { config } from "./config";

app.listen(config.port, () => console.log(`Backend listening on http://localhost:${config.port}`));