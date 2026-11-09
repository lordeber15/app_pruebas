import { ZONA_HORARIA_POR_DEFECTO, type Interrupcion, type TipoInterrupcion } from '@campo/core';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { iniciarInterrupcion, reanudarEjecucion } from './campo.ts';
import { Aviso, Boton, Campo, e, Segmentado, Separador, T } from './ui.tsx';

/**
 * Interrupciones o fallas de una ejecución (D01 T-10, RF-T05). Se registran con su motivo, sin
 * señal; no bloquean ni generan incumplimiento: solo descuentan su tiempo del esfuerzo efectivo.
 */

const NOMBRE: Readonly<Record<TipoInterrupcion, string>> = {
  interrupcion: 'Interrupción',
  falla: 'Falla de equipo o método',
};

const hora = (iso: string): string =>
  new Intl.DateTimeFormat('es-PE', {
    timeZone: ZONA_HORARIA_POR_DEFECTO,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

export const TarjetaInterrupciones = ({
  ejecucionId,
  lista,
  cerrada,
}: {
  ejecucionId: string;
  lista: readonly Interrupcion[];
  cerrada: boolean;
}) => {
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoInterrupcion | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const enCurso = lista.find((i) => i.fin === null);

  if (cerrada && lista.length === 0) return null;

  const guardar = async () => {
    if (tipo === null || motivo.trim() === '') {
      setError('Elija el tipo y escriba el motivo.');
      return;
    }
    setError(null);
    try {
      await iniciarInterrupcion(ejecucionId, tipo, motivo);
      setAbierto(false);
      setTipo(null);
      setMotivo('');
    } catch {
      setError('No se pudo guardar. Intente de nuevo.');
    }
  };

  return (
    <View style={[e.tarjeta, { gap: 10 }]}>
      <Text style={T.subtitulo}>Interrupciones o fallas</Text>
      {enCurso === undefined ? null : (
        <Aviso tipo="atencion">
          {NOMBRE[enCurso.tipo]} desde las {hora(enCurso.inicio)}: {enCurso.motivo}
        </Aviso>
      )}
      {lista
        .filter((i) => i.fin !== null)
        .map((i, n) => (
          <View key={i.id} style={{ gap: 2 }}>
            {n > 0 ? <Separador /> : null}
            <Text style={T.dato}>
              {NOMBRE[i.tipo]} · {hora(i.inicio)}–{i.fin === null ? '' : hora(i.fin)}
            </Text>
            <Text style={T.suave}>{i.motivo}</Text>
          </View>
        ))}
      {cerrada ? null : enCurso !== undefined ? (
        <Boton
          texto="Reanudar"
          alPresionar={() => {
            void reanudarEjecucion(ejecucionId).catch(() =>
              setError('No se pudo guardar. Intente de nuevo.'),
            );
          }}
        />
      ) : abierto ? (
        <View style={{ gap: 10 }}>
          <Segmentado
            etiqueta="Tipo"
            opciones={[
              { valor: 'interrupcion', texto: NOMBRE.interrupcion },
              { valor: 'falla', texto: NOMBRE.falla },
            ]}
            valor={tipo}
            alCambiar={setTipo}
          />
          <Campo
            etiqueta="Motivo"
            ayuda="Por ejemplo: lluvia fuerte, acceso bloqueado, batería agotada."
            value={motivo}
            onChangeText={setMotivo}
            maxLength={500}
            multiline
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Boton variante="secundario" texto="Cancelar" alPresionar={() => setAbierto(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Boton texto="Empezar ahora" alPresionar={() => void guardar()} />
            </View>
          </View>
        </View>
      ) : (
        <>
          {lista.length === 0 ? (
            <Text style={T.suave}>
              Si debe detenerse, regístrelo aquí con el motivo. No bloquea el cierre.
            </Text>
          ) : null}
          <Boton
            variante="secundario"
            texto="Registrar interrupción o falla"
            alPresionar={() => setAbierto(true)}
          />
        </>
      )}
      {error === null ? null : <Aviso>{error}</Aviso>}
    </View>
  );
};
