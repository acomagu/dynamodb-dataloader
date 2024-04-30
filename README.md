# DynamoDB DataLoader

This library provides a [DataLoader](https://github.com/graphql/dataloader) layer for efficient fetching from DynamoDB by caching and batching.

## Features

- Batch Loading: Combines multiple queries into fewer network requests to DynamoDB(only for `get` operation).
- Unified Caching: Caches are shared across get, query, and scan operations.
    - But this shared caching is effective only in limited scenarios, such as when entries previously fetched using query or scan are accessed again using get. Also, the feature does not function when only parts of records are retrieved.

## Initializing the DataLoader

Define the schema for your tables, specifying each table's name and the attribute names that form the keys used in caching.

```typescript
import { DynamodbDataLoader, TableSchema } from '@acomagu/dynamodb-dataloader';

const tableSchemas: TableSchema[] = [
  { tableName: "Users", keyAttributeNames: ["userId"] },
  { tableName: "Posts", keyAttributeNames: ["userId", "postId"] }, // PK and SK
]; // Used to enable cache sharing across query, scan, and get operations.

const options = {
  dynamodbClient: new DynamoDBClient({ /* AWS SDK configuration options */ }),
  getOptions: { /* BatchGet options */ },
};

const dynamodbDataLoader = new DynamodbDataLoader(tableSchemas, options); // All arguments are optional.
```

### Propagate with Express Context

Following best practices of DataLoader, a new instance of DynamodbDataLoader should be created per client request.

This example inserts the dataLoader to the Request object in express middleware.

```typescript
const app = express();

// Middleware to initialize DataLoader and store it in AsyncLocalStorage
app.use((req) => {
  req.dataLoader = new DynamodbDataLoader();
});

app.get('/user/:id', async (req, res) => {
  const item = await req.dataLoader.getter.load({
    TableName: "Users",
    Key: { userId: req.params.id },
  });
  res.send(item);
});
```

### Store to AsyncLocalStorage

The another way to isolate DataLoader per client request is using [AsyncLocalStorage](https://nodejs.org/api/async_context.html).

```typescript
const app = express();

const dynamodbDataLoaderStorage = new AsyncLocalStorage();

app.use((req, res, next) => {
  dynamodbDataLoaderStorage.run(new DynamodbDataLoader(), next);
});

app.get('/user/:id', async (req, res) => {
  const item = await dynamodbDataLoaderStorage.getStore()!.getter.load({
    TableName: "Users",
    Key: { userId: req.params.id },
  });
  res.send(item);
});
```

### Usage

## Fetching Data

### Get Operation

Fetch data for a specific user ID from the "Users" table using the getter DataLoader:

```typescript
const getUserRequest = {
  TableName: "Users",
  Key: { userId: "12345" }
};
const item = await dynamodbDataLoader.getter.load(getUserRequest);
```

### Query Operation

Example of querying posts for a specific user:

```typescript
const queryPostsRequest = {
  TableName: "Posts",
  KeyConditionExpression: "userId = :userId",
  ExpressionAttributeValues: {
    ":userId": "12345",
  },
};
const items = await dynamodbDataLoader.querier.load(queryPostsRequest);
```

### Scan Operation

Scanning for items with a specific filter:

```typescript
const scanRequest = {
  TableName: "Posts",
  FilterExpression: "contains(content, :content)",
  ExpressionAttributeValues: {
    ":content": "DynamoDB",
  },
};
const items = await dynamodbDataLoader.scanner.load(scanRequest);
```

### API Documentation

[Documentation](https://acomagu.github.io/dynamodb-dataloader)
