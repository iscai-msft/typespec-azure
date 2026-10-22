// Review store in Azure Cosmos DB (NoSQL API), reached with the App Service's managed
// identity. Key-based access stays disabled on the account.
import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import { sortReviews, type ReviewStore, type ReviewSubmission } from "../reviews.ts";

// One document per review, partitioned by library identity.
type ReviewDocument = ReviewSubmission & { identity: string };

export class CosmosReviewStore implements ReviewStore {
  container: Container;

  constructor({
    endpoint,
    database,
    container,
  }: {
    endpoint: string;
    database: string;
    container: string;
  }) {
    const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
    this.container = client.database(database).container(container);
  }

  async list(): Promise<ReviewSubmission[]> {
    const { resources } = await this.container.items
      .query<ReviewDocument>("SELECT c.id, c.submittedAt, c.reviewer, c.request FROM c")
      .fetchAll();
    return sortReviews(resources);
  }

  async add(review: ReviewSubmission): Promise<void> {
    const document: ReviewDocument = { ...review, identity: review.request.identity };
    await this.container.items.create(document);
  }
}
