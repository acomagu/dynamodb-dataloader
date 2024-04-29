import * as dynamodb from '@aws-sdk/client-dynamodb';
import * as dynamodbLib from '@aws-sdk/lib-dynamodb';
import * as dynamodbUtil from '@aws-sdk/util-dynamodb';
import DataLoader from 'dataloader';

export interface GetRequest {
  TableName: string;
  Key: Record<string, dynamodbUtil.NativeScalarAttributeValue>;
}

export type ScanRequest = Pick<dynamodbLib.ScanCommandInput,
  | 'ConsistentRead'
  | 'ExpressionAttributeNames'
  | 'ExpressionAttributeValues'
  | 'FilterExpression'
  | 'IndexName'
  | 'Limit'
  | 'ProjectionExpression'
  | 'ReturnConsumedCapacity'
  | 'Segment'
  | 'Select'
  | 'TableName'
  | 'TotalSegments'
>;

export type QueryRequest = Pick<dynamodbLib.QueryCommandInput,
  | 'ConsistentRead'
  | 'ExpressionAttributeNames'
  | 'ExpressionAttributeValues'
  | 'FilterExpression'
  | 'IndexName'
  | 'KeyConditionExpression'
  | 'Limit'
  | 'ProjectionExpression'
  | 'ReturnConsumedCapacity'
  | 'ScanIndexForward'
  | 'Select'
  | 'TableName'
>;

export interface TableSchema {
  readonly tableName: string;
  readonly keyAttributeNames: readonly [string] | readonly [string, string];
}

export class DynamodbDataLoader {
  dynamodbClient: dynamodb.DynamoDBClient;
  dynamodbDocumentClient: dynamodbLib.DynamoDBDocumentClient;

  scanner = new DataLoader<ScanRequest, Record<string, unknown>[], string>(scanRequests =>
    Promise.all(scanRequests.map(async scanRequest => {
      const iter = dynamodbLib.paginateScan({
        client: this.dynamodbDocumentClient,
      }, scanRequest);

      const items = [];
      for await (const page of iter) {
        if (page.Items) items.push(...page.Items);
      }

      if (this.tableSchemas && (!scanRequest.Select || scanRequest.Select === dynamodb.Select.ALL_ATTRIBUTES)) {
        const tableSchema = this.tableSchemas.find(s => s.tableName === scanRequest.TableName);
        if (!tableSchema) {
          console.warn(`DynamoDB Dataloader: Could not find table schema of table ${scanRequest.TableName}`);
          return items;
        }

        for (const item of items) {
          const key = tableSchema.keyAttributeNames.reduce((key, attrName) => ({
            ...key,
            [attrName]: item[attrName],
          }), {});

          if (Object.values(key).includes(undefined) || Object.values(key).includes(null)) continue;

          this.getter.prime({
            TableName: scanRequest.TableName ?? '',
            Key: key,
          }, item);
        }
      }

      return items;
    })),
    {
      cacheKeyFn(key) {
        return JSON.stringify({
          ExpressionAttributeNames: key.ExpressionAttributeNames,
          ExpressionAttributeValues: key.ExpressionAttributeValues,
          FilterExpression: key.FilterExpression,
          Limit: key.Limit,
          ProjectionExpression: key.ProjectionExpression,
          Select: key.Select,
          TableName: key.TableName,
        });
      },
    },
  );
  querier = new DataLoader<QueryRequest, Record<string, unknown>[], string>(queryRequests =>
    Promise.all(queryRequests.map(async queryRequest => {
      const iter = dynamodbLib.paginateQuery({
        client: this.dynamodbDocumentClient,
      }, queryRequest);

      const items = [];
      for await (const page of iter) {
        if (page.Items) items.push(...page.Items);
      }

      if (this.tableSchemas && (!queryRequest.Select || queryRequest.Select === dynamodb.Select.ALL_ATTRIBUTES)) {
        const tableSchema = this.tableSchemas.find(s => s.tableName === queryRequest.TableName);
        if (!tableSchema) {
          console.warn(`DynamoDB Dataloader: Could not find table schema of table ${queryRequest.TableName}`);
          return items;
        }

        for (const item of items) {
          const key = tableSchema.keyAttributeNames.reduce((key, attrName) => ({
            ...key,
            [attrName]: item[attrName],
          }), {});

          if (Object.values(key).includes(undefined) || Object.values(key).includes(null)) continue;

          this.getter.prime({
            TableName: queryRequest.TableName ?? '',
            Key: key,
          }, item);
        }
      }

      return items;
    })),
    {
      cacheKeyFn(key) {
        return JSON.stringify({
          ExpressionAttributeNames: key.ExpressionAttributeNames,
          ExpressionAttributeValues: key.ExpressionAttributeValues,
          FilterExpression: key.FilterExpression,
          KeyConditionExpression: key.KeyConditionExpression,
          Limit: key.Limit,
          ProjectionExpression: key.ProjectionExpression,
          Select: key.Select,
          TableName: key.TableName,
        });
      },
    },
  );
  getter = new DataLoader<GetRequest, unknown, string>(
    async (getRequests) => {
      const byTableName = Object.groupBy(getRequests, req => req.TableName);
      let requestItems: dynamodb.BatchGetItemCommandInput['RequestItems'] = Object.fromEntries(Object.entries(byTableName).flatMap(([tableName, reqs]) => {
        if (!reqs) return [];
        return [[tableName, {
          Keys: reqs.map(req => dynamodbUtil.marshall(req.Key)),

          ConsistentRead: this.options?.getOptions?.ConsistentRead,
          ExpressionAttributeNames: this.options?.getOptions?.ExpressionAttributeNames,
          ProjectionExpression: this.options?.getOptions?.ProjectionExpression,
        }]];
      }));

      let responses: Record<string, Record<string, dynamodb.AttributeValue>[]> = {};
      while (requestItems && Object.values(requestItems).flat().length) {
        const result: dynamodb.BatchGetItemCommandOutput = await this.dynamodbClient.send(new dynamodb.BatchGetItemCommand({
          RequestItems: requestItems,
          ReturnConsumedCapacity: this.options?.getOptions?.ReturnConsumedCapacity,
        }));

        responses = {
          ...responses,
          ...result.Responses,
        };

        requestItems = result.UnprocessedKeys;
      }

      const items = getRequests.map(getRequest =>
        responses[getRequest.TableName]?.find(item =>
          Object.entries(getRequest.Key).every(([attr, expected]) => {
            const a = item[attr];
            const b = dynamodbUtil.convertToAttr(expected);

            if (a === b) return true;

            if (a?.S) return a.S === b.S;
            if (a?.N) return a.N === b.N;
            if (a?.B) {
              if (!b.B) return false;
              return Buffer.from(a.B).equals(Buffer.from(b.B));
            }

            throw new Error(`Unexpected key: ${JSON.stringify(a)}`);
          }),
        ),
      );

      return items.map(item => item ? dynamodbUtil.unmarshall(item) : item);
    },
    {
      maxBatchSize: 100,
      cacheKeyFn: ({ TableName, Key }) => {
        return TableName + '|' + Object.keys(Key).sort().map(k => k + ':' + Key[k]).join('|');
      },
    },
  );

  constructor(readonly tableSchemas?: readonly TableSchema[], readonly options?: {
    readonly dynamodbClient?: dynamodb.DynamoDBClient;
    readonly getOptions?: Pick<dynamodb.KeysAndAttributes, 'ConsistentRead' | 'ProjectionExpression' | 'ExpressionAttributeNames'> & Pick<dynamodb.BatchGetItemCommandInput, 'ReturnConsumedCapacity'>;
  }) {
    this.dynamodbClient = options?.dynamodbClient ?? new dynamodb.DynamoDBClient({});
    this.dynamodbDocumentClient = dynamodbLib.DynamoDBDocumentClient.from(this.dynamodbClient);
  }
}
