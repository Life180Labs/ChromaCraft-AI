const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const connection = new IORedis('redis://default:redispw@localhost:6379');
const generateQueue = new Queue('generate', { connection });

async function main() {
  const failed = await generateQueue.getFailed();
  if (failed.length > 0) {
    console.log("Last failed reason:", failed[0].failedReason);
    console.log("Stacktrace:", failed[0].stacktrace);
  }
}
main().finally(() => connection.quit());
