const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const prisma = new PrismaClient();
const connection = new IORedis({ host: 'localhost', port: 6379 });
const generateQueue = new Queue('generate', { connection });

async function main() {
  const jobs = await prisma.job.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: { provider: true }
  });
  console.log("--- DB JOBS ---");
  console.log(JSON.stringify(jobs, null, 2));

  const waiting = await generateQueue.getWaiting();
  const active = await generateQueue.getActive();
  const failed = await generateQueue.getFailed();
  
  console.log("\n--- BULLMQ GENERATE QUEUE ---");
  console.log("Waiting:", waiting.length);
  console.log("Active:", active.length);
  console.log("Failed:", failed.length);
  
  if (failed.length > 0) {
    console.log("Last failed reason:", failed[0].failedReason);
  }
}

main()
  .catch(console.error)
  .finally(() => {
    prisma.$disconnect();
    connection.quit();
  });
