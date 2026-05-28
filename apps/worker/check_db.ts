import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const providers = await prisma.aiProvider.findMany();
  console.log('Providers:', providers);
  
  const jobs = await prisma.job.findMany({
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: { assets: true, generation: true }
  });
  console.log('Latest Job:', JSON.stringify(jobs[0], null, 2));
}

main().finally(() => prisma.$disconnect());
