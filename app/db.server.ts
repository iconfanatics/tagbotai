import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

declare global {
  // eslint-disable-next-line no-var
  var __db__: PrismaClient | undefined;
}

if (!global.__db__) {
  const adapter = new PrismaLibSQL({
    url: process.env.TURSO_DATABASE_URL || "file:dev.sqlite",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  global.__db__ = new PrismaClient({ adapter });
}

// Ensure the typescript compiler knows it's always initialized
const prisma = global.__db__;

export default prisma;
