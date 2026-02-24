import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

const adapter = new PrismaLibSQL({
  url: process.env.TURSO_DATABASE_URL || "file:dev.sqlite",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const prisma = global.prismaGlobal ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}

export default prisma;
