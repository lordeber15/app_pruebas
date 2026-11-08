import { z } from 'zod';

/**
 * Política de contraseñas (decisión del usuario, 2026-11-07): al menos 8 caracteres con una
 * mayúscula, una minúscula y un número. La misma regla la aplican la API, la web y el celular.
 * El alta y el restablecimiento entregan una contraseña temporal que se cambia en el primer
 * ingreso.
 */
export const CONTRASENA_MIN = 8;
export const CONTRASENA_MAX = 128;

export interface RequisitoContrasena {
  readonly clave: 'largo' | 'mayuscula' | 'minuscula' | 'numero';
  readonly texto: string;
  readonly cumple: (contrasena: string) => boolean;
}

export const REQUISITOS_CONTRASENA: readonly RequisitoContrasena[] = [
  {
    clave: 'largo',
    texto: `Al menos ${String(CONTRASENA_MIN)} caracteres`,
    cumple: (c) => c.length >= CONTRASENA_MIN,
  },
  { clave: 'mayuscula', texto: 'Una letra mayúscula', cumple: (c) => /\p{Lu}/u.test(c) },
  { clave: 'minuscula', texto: 'Una letra minúscula', cumple: (c) => /\p{Ll}/u.test(c) },
  { clave: 'numero', texto: 'Un número', cumple: (c) => /\p{Nd}/u.test(c) },
];

export const cumpleContrasena = (contrasena: string): boolean =>
  contrasena.length <= CONTRASENA_MAX &&
  REQUISITOS_CONTRASENA.every((r) => r.cumple(contrasena));

export const contrasenaSchema = z
  .string()
  .max(CONTRASENA_MAX, `Como máximo ${String(CONTRASENA_MAX)} caracteres`)
  .superRefine((c, ctx) => {
    for (const r of REQUISITOS_CONTRASENA) {
      if (!r.cumple(c))
        ctx.addIssue({ code: 'custom', message: `Falta: ${r.texto.toLowerCase()}` });
    }
  });

/** Cambio de la propia contraseña: la nueva cumple la política y es distinta de la actual. */
export const cambioContrasenaSchema = z
  .object({
    actual: z.string().min(1).max(CONTRASENA_MAX),
    nueva: contrasenaSchema,
  })
  .refine((c) => c.actual !== c.nueva, {
    message: 'La contraseña nueva debe ser distinta de la actual',
    path: ['nueva'],
  });

// Sin caracteres que se confunden al dictarla o copiarla (0/O, 1/l/I).
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnpqrstuvwxyz';
const NUMEROS = '23456789';
const TODOS = MAYUSCULAS + MINUSCULAS + NUMEROS;

/**
 * Contraseña temporal que siempre cumple la política. Recibe la fuente de azar (core no tiene
 * I/O): en la API, `crypto.randomBytes`. Se descarta el sesgo del módulo rechazando los bytes altos.
 */
export const generarContrasenaTemporal = (
  aleatorio: (n: number) => Uint8Array,
  largo = 12,
): string => {
  /** Entero uniforme en [0, n), n ≤ 256. */
  const indice = (n: number): number => {
    const tope = 256 - (256 % n);
    for (;;) {
      for (const b of aleatorio(16)) if (b < tope) return b % n;
    }
  };
  const elegir = (alfabeto: string): string => alfabeto[indice(alfabeto.length)] ?? '';
  const caracteres = [elegir(MAYUSCULAS), elegir(MINUSCULAS), elegir(NUMEROS)];
  while (caracteres.length < Math.max(largo, CONTRASENA_MIN)) caracteres.push(elegir(TODOS));
  // Mezcla de Fisher-Yates para que las clases obligatorias no queden siempre al inicio.
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = indice(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j] ?? '', caracteres[i] ?? ''];
  }
  return caracteres.join('');
};
