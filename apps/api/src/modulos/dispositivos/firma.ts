import { createPublicKey, verify, type KeyObject } from 'node:crypto';

/**
 * Llave del dispositivo: ECDSA P-256 (disponible en Keystore, Keychain y WebCrypto).
 * La pública llega como SPKI DER en base64; la firma, en formato IEEE P1363 (r‖s, 64 bytes,
 * el que produce WebCrypto) codificada en base64url.
 */
export const leerLlavePublica = (spkiBase64: string): KeyObject | null => {
  try {
    const llave = createPublicKey({
      key: Buffer.from(spkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const ok =
      llave.asymmetricKeyType === 'ec' && llave.asymmetricKeyDetails?.namedCurve === 'prime256v1';
    return ok ? llave : null;
  } catch {
    return null;
  }
};

/** Mensaje exacto que firma el celular para renovar su sesión. */
export const mensajeRenovacion = (dispositivoId: string, momento: string, nonce: string): Buffer =>
  Buffer.from(`campo-renovar\n${dispositivoId}\n${momento}\n${nonce}`, 'utf8');

export const firmaValida = (llave: KeyObject, mensaje: Buffer, firmaBase64url: string): boolean => {
  const firma = Buffer.from(firmaBase64url, 'base64url');
  if (firma.length !== 64) return false;
  try {
    return verify('sha256', mensaje, { key: llave, dsaEncoding: 'ieee-p1363' }, firma);
  } catch {
    return false;
  }
};
