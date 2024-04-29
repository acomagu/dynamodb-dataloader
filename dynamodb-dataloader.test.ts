import * as dynamodb from '@aws-sdk/client-dynamodb';
import * as dynamodbLib from '@aws-sdk/lib-dynamodb';
import * as assert from 'node:assert/strict';
import test from 'node:test';
import { DynamodbDataLoader } from './dynamodb-dataloader.js';

const dynamodbClient = new dynamodb.DynamoDBClient({});

const tableName = `TestTable_${Math.random().toString(32).substring(2)}`;

test.before(async () => {
  await dynamodbClient.send(new dynamodb.CreateTableCommand({
    TableName: tableName,
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'B' },
    ],
    KeySchema: [
      { KeyType: 'HASH', AttributeName: 'pk' },
      { KeyType: 'RANGE', AttributeName: 'sk' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  }));
  await dynamodb.waitUntilTableExists({
    client: dynamodbClient,
    maxWaitTime: 60,
  }, {
    TableName: tableName,
  });
  await dynamodbClient.send(new dynamodbLib.BatchWriteCommand({
    RequestItems: {
      [tableName]: [
        {
          PutRequest: {
            Item: {
              pk: 'pk1',
              sk: Buffer.from('sk1'),
              attr: 'attr1',
            },
          },
        }
      ],
    },
  }));
});

test.after(async () => {
  await dynamodbClient.send(new dynamodb.DeleteTableCommand({
    TableName: tableName,
  }));
});

await test('dynamodbDataLoader', async () => {
  const result: any = await new DynamodbDataLoader().getter.load({
    TableName: tableName,
    Key: {
      pk: 'pk1',
      sk: Buffer.from('sk1'),
    },
  });

  assert.equal(result.attr, 'attr1');
});
