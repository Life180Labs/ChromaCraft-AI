import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.job.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { generation: true, assets: true }
  });
  
  for (const job of jobs) {
    console.log(`Job ID: ${job.id}, Status: ${job.status}, Name: ${job.name}`);
    console.log(`  Generation Metadata: ${JSON.stringify(job.generation?.metadata)}`);
    console.log(`  Assets count: ${job.assets.length}`);
    const spins = job.assets.filter(a => a.type === 'spin_frame' || a.type === 'spin');
    const videos = job.assets.filter(a => a.type === 'video');
    console.log(`  Spin assets: ${spins.length}, Video assets: ${videos.length}`);
  }
}

main().finally(() => prisma.$disconnect());
