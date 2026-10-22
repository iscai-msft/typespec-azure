// App Service entry point: the published dashboard plus the review API, backed by Cosmos DB.
// Settings (App Service application settings, written by infra/main.bicep):
//   COSMOS_ENDPOINT, COSMOS_DATABASE, COSMOS_CONTAINER  where reviews are stored
//   SDK_METRICS_REVIEWERS  comma-separated sign-in names allowed to review, or "*"
//   SITE_DIR  the published site folder (default: ./site next to this file)
//   WEBSITE_AUTH_ENABLED  set by App Service when its sign-in is on; required to trust it
import { fileURLToPath } from "node:url";
import { parseReviewers } from "../reviews.ts";
import { createReviewServer } from "../server.ts";
import { CosmosReviewStore } from "./cosmos-store.ts";

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing application setting ${name}`);
  return value;
}

const store = new CosmosReviewStore({
  endpoint: setting("COSMOS_ENDPOINT"),
  database: process.env.COSMOS_DATABASE ?? "sdkmetrics",
  container: process.env.COSMOS_CONTAINER ?? "reviews",
});
const server = createReviewServer({
  siteDirectory: process.env.SITE_DIR ?? fileURLToPath(new URL("./site", import.meta.url)),
  store,
  reviewers: parseReviewers(process.env.SDK_METRICS_REVIEWERS),
  trustAuthHeaders: process.env.WEBSITE_AUTH_ENABLED?.toLowerCase() === "true",
});
const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`SDK customization metrics listening on ${port}`));
