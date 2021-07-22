const cascade = require('../kafka-cascade/index');
import * as Types from '../kafka-cascade/src/kafkaInterface';
import { TestKafka, TestProducer } from './cascade.mockclient.test';

console.log = jest.fn();
process.env.test = 'test';

describe('Testing timeout retry strategy', () => {
  let kafka: TestKafka;
  let testService: any;

  beforeEach(() => {
    kafka = new TestKafka();
  });

  it('Always fail on the sendTimeout route', async () => {
    const serviceAction = (msg: Types.KafkaConsumerMessageInterface, resolve: any, reject: any) => {
      try {
        reject(msg);
      }
      catch(error) {
        console.log('Caught error in service CB: ' + error);
      }
    }

    const dlq = jest.fn();

    testService = await cascade.service(kafka, 'test-topic', 'test-group', serviceAction, jest.fn(), dlq);
    const retryLevels = 2;
    await testService.setDefaultRoute(retryLevels, { timeoutLimit:(new Array(retryLevels).fill(1)) } );
    await testService.connect();
    await testService.run();

    const producer = kafka.producer();
    const messageCount = 10;

    for(let i = 0; i < messageCount; i++) {
      await producer.send({
        topic: 'test-topic',
        messages: [{
          value: 'test message',
        }],
      });
    }


    expect(producer.offsets['test-topic'].count).toBe(messageCount);
    const testServiceOffsets = testService.producer.producer.offsets;
    expect(Object.keys(testServiceOffsets)).toHaveLength(retryLevels);
    for(let topic in testServiceOffsets) {
      expect(testServiceOffsets[topic].count).toBe(messageCount);
    }
    expect(dlq).toHaveBeenCalledTimes(messageCount);
  })
});

describe('Testing batching retry strategy', () => {
  let kafka: TestKafka;
  let testService: any;
  let producer: TestProducer;
  let messageCount: number;
  let retryLevels: number;
  let dlq: any

  beforeAll(async () => {
    kafka = new TestKafka();

    const serviceAction = (msg: Types.KafkaConsumerMessageInterface, resolve: any, reject: any) => {
      try {
        reject(msg);
      }
      catch(error) {
        console.log('Caught error in service CB: ' + error);
      }
    }

    dlq = jest.fn();

    testService = await cascade.service(kafka, 'test-topic', 'test-group', serviceAction, jest.fn(), dlq);
    retryLevels = 2;
    messageCount = 10;
    await testService.setDefaultRoute(retryLevels, { batchLimit:(new Array(retryLevels).fill(messageCount)) } );
    await testService.connect();
    await testService.run();

    producer = kafka.producer();
    for(let i = 0; i < messageCount - 1; i++) {
      await producer.send({
        topic: 'test-topic',
        messages: [{
          value: 'test message',
        }],
      });
    }
  });

  it('MessageCount is not change before the number of messages equals to batch number', () => {
    expect(producer.offsets['test-topic'].count).toBe(messageCount - 1);
    const testServiceOffsets = testService.producer.producer.offsets;
    expect(Object.keys(testServiceOffsets)).toHaveLength(0);
    expect(testService.producer.routes[0].levels[0].messages).toHaveLength(messageCount - 1);
    expect(dlq).not.toHaveBeenCalled();
  });
  
  it('MessageCount is incremented when the number of messages equals to batch number', async () => {
    await producer.send({
      topic: 'test-topic',
      messages: [{
        value: 'test message',
      }],
    });
    
    expect(producer.offsets['test-topic'].count).toBe(messageCount);
    const testServiceOffsets = testService.producer.producer.offsets;
    expect(Object.keys(testServiceOffsets)).toHaveLength(retryLevels);
    for(let topic in testServiceOffsets) {
      expect(testServiceOffsets[topic].count).toBe(messageCount);
    }
    expect(dlq).toHaveBeenCalledTimes(messageCount);
  });
  
});