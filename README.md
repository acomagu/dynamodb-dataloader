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
