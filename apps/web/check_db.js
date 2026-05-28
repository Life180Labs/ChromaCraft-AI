const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.job.findMany({orderBy: {id: 'desc'}, take: 1, include: {generation: true}}).then(x => console.log(JSON.stringify(x, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
