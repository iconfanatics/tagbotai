import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

declare global {
  // eslint-disable-next-line no-var
  var __db__: PrismaClient | undefined;
}

if (!global.__db__) {
  const libsql = createClient({
    url: process.env.TURSO_DATABASE_URL || "file:dev.sqlite",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const adapter = new PrismaLibSQL(libsql);
  global.__db__ = new PrismaClient({ adapter });
}

// Ensure the typescript compiler knows it's always initialized
const prisma = global.__db__;

export default prisma;
