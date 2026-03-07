import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
    const logs = await db.activityLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { rule: true }
    });
    console.log(JSON.stringify(logs, null, 2));
}

main().catch(console.error).finally(() => db.$disconnect());
