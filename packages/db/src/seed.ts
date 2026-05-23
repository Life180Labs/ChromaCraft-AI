import path from 'path';
import { fileURLToPath } from 'url';
// @ts-ignore
import dotenv from 'dotenv';
// @ts-ignore
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@life180labs.com' },
    update: {},
    create: {
      email: 'admin@life180labs.com',
      passwordHash: passwordHash,
      role: 'ADMIN',
    },
  });
  console.log('✅ Seeded admin user');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
