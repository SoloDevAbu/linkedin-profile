import { env } from "./config/env.js";
import { buildApp } from "./app.js";

const app = buildApp();

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
