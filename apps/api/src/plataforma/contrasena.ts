import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Argon2id con los parámetros mínimos recomendados por OWASP (19 MiB, 2 pasadas, 1 hilo),
 * usando la implementación nativa de Node 24. Se configura explícitamente en Better Auth
 * (CLAUDE.md, Seguridad): no se depende de su valor por defecto (scrypt).
 *
 * Formato PHC: $argon2id$v=19$m=19456,t=2,p=1$<sal>$<hash> (base64 sin relleno).
 */
const argon2Async = promisify(argon2);

const PARAMETROS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const LARGO_SAL = 16;

const b64 = (b: Buffer): string => b.toString('base64').replace(/=+$/, '');

const derivar = (
  contrasena: string,
  sal: Buffer,
  p: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> => argon2Async('argon2id', { message: contrasena, nonce: sal, ...p });

export const hashContrasena = async (contrasena: string): Promise<string> => {
  const sal = randomBytes(LARGO_SAL);
  const hash = await derivar(contrasena, sal, PARAMETROS);
  const { memory: m, passes: t, parallelism: p } = PARAMETROS;
  return `$argon2id$v=19$m=${String(m)},t=${String(t)},p=${String(p)}$${b64(sal)}$${b64(hash)}`;
};

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export const verificarContrasena = async ({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> => {
  const partes = PHC.exec(hash);
  if (partes === null) return false;
  const [, m, t, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64 ?? '', 'base64');
  const calculado = await derivar(password, Buffer.from(salB64 ?? '', 'base64'), {
    memory: Number(m),
    passes: Number(t),
    parallelism: Number(p),
    tagLength: esperado.length,
  });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
};
