// Duck-typed check for Prisma's unique-constraint violation (P2002), rather than
// `instanceof Prisma.PrismaClientKnownRequestError` — works the same against the
// real error class and against a test double that only sets `.code`.
export function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
}
