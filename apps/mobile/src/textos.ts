import type { TipoUnidad } from '@campo/core';

/** Nombre visible de cada tipo de unidad (D02 §3), en singular. */
export const NOMBRE_UNIDAD: Readonly<Record<TipoUnidad, string>> = {
  transecto: 'transecto',
  cuadrante: 'cuadrante',
  parcela: 'parcela',
  recorrido: 'recorrido',
  arbol: 'árbol hospedero',
  punto: 'punto',
  trampa: 'trampa',
  bandeja: 'bandeja',
  red: 'red',
  camara: 'cámara',
  detector: 'detector',
  lista: 'lista',
  sector: 'sector',
  abs: 'sitio ABS',
  evento: 'registro',
  atributo: 'atributo',
};

/** Quita el prefijo «U-01: » de los mensajes del motor cuando ya se muestra dentro de la unidad. */
export const sinCodigo = (mensaje: string, codigo: string): string =>
  mensaje.startsWith(`${codigo}: `) ? mensaje.slice(codigo.length + 2) : mensaje;

export const mayuscula = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
