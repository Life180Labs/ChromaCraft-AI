const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const assets = await prisma.asset.findMany({
    where: { jobId: 32 }
  });
  console.log(JSON.stringify(assets, null, 2));
}

main().finally(() => prisma.$disconnect());
