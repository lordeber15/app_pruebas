import { Buffer, CryptoKey, subtle } from 'react-native-quick-crypto';
import { CLAVES, generarId, llavero } from './plataforma.ts';

/**
 * Sesión del celular (doc. 02 §6.1):
 * 1. Login en línea con documento y contraseña → token.
 * 2. El celular genera su par ECDSA P-256 y activa el dispositivo con la llave pública.
 * 3. Cuando el token vence, se renueva firmando un mensaje con la llave privada (SEG-05).
 */

export class ErrorServidor extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

export const servidor = async (): Promise<string> => {
  const s = await llavero.leer(CLAVES.servidor);
  if (s === null)
    throw new ErrorServidor(0, 'SIN_SERVIDOR', 'Configure la dirección del servidor.');
  return s;
};

const sinConexion = () =>
  new ErrorServidor(
    0,
    'SIN_CONEXION',
    'Sin conexión con el servidor. Lo guardado se enviará después.',
  );

const leerProblema = async (r: Response): Promise<ErrorServidor> => {
  try {
    const p = (await r.json()) as { detail?: string; codigo?: string };
    return new ErrorServidor(
      r.status,
      p.codigo ?? 'ERROR',
      p.detail ?? 'El servidor rechazó la solicitud.',
    );
  } catch {
    return new ErrorServidor(r.status, 'ERROR', 'El servidor rechazó la solicitud.');
  }
};

/** Solicitud con el token actual; si vence, lo renueva con la llave del dispositivo y reintenta. */
export const pedir = async <T>(
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
  reintento = true,
): Promise<T> => {
  const base = await servidor();
  const token = await llavero.leer(CLAVES.token);
  let r: Response;
  try {
    r = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    });
  } catch {
    throw sinConexion();
  }
  if (r.status === 401 && reintento && (await llavero.leer(CLAVES.dispositivo)) !== null) {
    await renovar();
    return pedir<T>(metodo, ruta, cuerpo, false);
  }
  if (!r.ok) throw await leerProblema(r);
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
};

export const tokenActual = () => llavero.leer(CLAVES.token);

export const entrar = async (tipo: string, numero: string, contrasena: string): Promise<void> => {
  const base = await servidor();
  let r: Response;
  try {
    r = await fetch(`${base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: `${tipo}.${numero.trim()}`.toLowerCase(),
        password: contrasena,
      }),
    });
  } catch {
    throw sinConexion();
  }
  if (!r.ok) throw await leerProblema(r);
  const sesionNueva = r.headers.get('set-auth-token') ?? '';
  if (sesionNueva === '')
    throw new ErrorServidor(500, 'SIN_TOKEN', 'El servidor no devolvió la sesión.');
  await llavero.guardar(CLAVES.token, sesionNueva);
  const { user } = (await r.json()) as { user?: { id?: string } };
  if (typeof user?.id === 'string') await llavero.guardar(CLAVES.usuario, user.id);
};

/** exportKey devuelve binario para spki y pkcs8 (JWK solo con el formato 'jwk'). */
const binario = (x: unknown): Buffer => {
  if (x instanceof ArrayBuffer) return Buffer.from(x);
  throw new Error('Formato de llave inesperado.');
};

/** Genera el par de llaves, activa el dispositivo y guarda la privada en el llavero. */
export const activarDispositivo = async (versionApp: string): Promise<void> => {
  const par = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  if (
    !('privateKey' in par) ||
    !(par.privateKey instanceof CryptoKey) ||
    !(par.publicKey instanceof CryptoKey)
  ) {
    throw new Error('No se generó el par de llaves.');
  }
  const spki = binario(await subtle.exportKey('spki', par.publicKey)).toString('base64');
  const pkcs8 = binario(await subtle.exportKey('pkcs8', par.privateKey)).toString('base64');
  const r = await pedir<{ dispositivo_id: string }>('POST', '/api/v1/dispositivos/activar', {
    plataforma: 'android',
    llave_publica: spki,
    version_app: versionApp,
    token_push: null,
  });
  await llavero.guardar(CLAVES.llavePrivada, pkcs8);
  await llavero.guardar(CLAVES.dispositivo, r.dispositivo_id);
};

/** SEG-05: firma "campo-renovar\n<dispositivo>\n<momento>\n<nonce>" y recibe un token nuevo. */
export const renovar = async (): Promise<void> => {
  const [pkcs8, dispositivoId] = await Promise.all([
    llavero.leer(CLAVES.llavePrivada),
    llavero.leer(CLAVES.dispositivo),
  ]);
  if (pkcs8 === null || dispositivoId === null)
    throw new ErrorServidor(401, 'SIN_DISPOSITIVO', 'Ingrese de nuevo.');
  const llave = await subtle.importKey(
    'pkcs8',
    Buffer.from(pkcs8, 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const momento = new Date().toISOString();
  const nonce = generarId().replaceAll('-', '');
  const mensaje = Buffer.from(`campo-renovar\n${dispositivoId}\n${momento}\n${nonce}`, 'utf8');
  const firma = Buffer.from(
    await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, llave, mensaje),
  ).toString('base64url');
  const base = await servidor();
  let r: Response;
  try {
    r = await fetch(`${base}/api/v1/dispositivos/renovar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dispositivo_id: dispositivoId, momento, nonce, firma }),
    });
  } catch {
    throw sinConexion();
  }
  if (!r.ok) throw await leerProblema(r);
  const { token } = (await r.json()) as { token: string };
  await llavero.guardar(CLAVES.token, token);
};

/** Cierra la sesión del celular y olvida la llave (tras una baja remota o al salir). */
export const olvidarSesion = async (): Promise<void> => {
  for (const c of [
    CLAVES.token,
    CLAVES.llavePrivada,
    CLAVES.dispositivo,
    CLAVES.pin,
    CLAVES.usuario,
  ])
    await llavero.borrar(c);
};
