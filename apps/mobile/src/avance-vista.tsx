import { ETIQUETA_ESTADO_ESTACION, type EstadoEstacion } from '@campo/core';
import { Text, View } from 'react-native';
import { textoAvance, type AvanceEstacionLocal } from './avance.ts';
import { BarraProgreso, Etiqueta, T } from './ui.tsx';

/** Tono de la etiqueta de estado; el texto siempre acompaña al color. */
export const TONO_ESTADO: Readonly<
  Record<EstadoEstacion, 'neutro' | 'ok' | 'atencion' | 'error' | 'tinta'>
> = {
  con_incumplimiento: 'error',
  completa: 'ok',
  en_curso: 'atencion',
  reprogramada: 'neutro',
  sin_datos: 'neutro',
  sin_iniciar: 'neutro',
};

/**
 * Avance de la estación con lo registrado en este celular (decisión del usuario, 2026-11-08):
 * «4 de 7 métodos completos · 57 %», barra y estado. Sin ejecuciones no se afirma 0 % (RN-37).
 */
export const ResumenAvanceEstacion = ({
  avance,
  compacto = false,
}: {
  avance: AvanceEstacionLocal;
  compacto?: boolean;
}) => {
  const texto = textoAvance(avance);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Etiqueta
          tono={TONO_ESTADO[avance.estado]}
          texto={ETIQUETA_ESTADO_ESTACION[avance.estado]}
        />
        <Text style={[T.dato, { flexShrink: 1 }]}>{texto}</Text>
      </View>
      {avance.aplicables > 0 ? (
        <BarraProgreso
          porcentaje={avance.porcentaje}
          etiqueta={`Avance de la estación: ${texto}`}
        />
      ) : null}
      {compacto ? null : <Text style={T.suave}>Según lo registrado en este celular.</Text>}
    </View>
  );
};
