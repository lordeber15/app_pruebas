import { ETIQUETA_CATEGORIA_LOGISTICA } from '@campo/core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  estadoLocal,
  ETIQUETA_ESTADO_LOCAL,
  ETIQUETA_TIPO,
  explicarMotivo,
  misAlertas,
  type AlertaLocal,
} from '../src/alertas.ts';
import { leerPaquete } from '../src/campo.ts';
import { useApp } from '../src/estado.ts';
import {
  AccionInferior,
  Aviso,
  BarraEstado,
  Boton,
  C,
  e,
  Etiqueta,
  Grupo,
  Separador,
  T,
} from '../src/ui.tsx';

const FORMATO = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const TONO = { pendiente_sync: 'atencion', enviada: 'ok', no_aceptada: 'error' } as const;

/**
 * Alertas registradas en este celular con su estado local (D02 §13). Las respuestas y el cierre
 * los ve en la web: el celular solo sabe si la alerta salió y si el servidor la aceptó.
 */
export default function MisAlertas() {
  const insets = useSafeAreaInsets();
  const version = useApp((s) => s.version);
  const [alertas, setAlertas] = useState<AlertaLocal[] | null>(null);
  const [estaciones, setEstaciones] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const d = await leerPaquete();
          setEstaciones(new Map((d?.paquete.estaciones ?? []).map((x) => [x.id, x.codigo])));
          setAlertas(await misAlertas());
          setError(false);
        } catch {
          setError(true);
        }
      })();
    }, [version]),
  );

  return (
    <View style={e.pantalla}>
      <BarraEstado />
      <ScrollView contentContainerStyle={[e.contenido, { gap: 16 }]}>
        {error ? <Aviso>No se pudieron leer las alertas guardadas. Intente de nuevo.</Aviso> : null}
        {alertas === null && !error ? <Text style={T.suave}>Cargando alertas…</Text> : null}
        {alertas?.length === 0 ? (
          <View style={[e.tarjeta, { gap: 4 }]}>
            <Text style={T.subtitulo}>Aún no registró alertas</Text>
            <Text style={T.suave}>
              Registre solo excepciones: lo que está conforme no necesita alerta.
            </Text>
          </View>
        ) : null}
        {alertas !== null && alertas.length > 0 ? (
          <Grupo titulo="Mis alertas">
            {alertas.map((a, i) => {
              const est = estadoLocal(a.resultado);
              return (
                <View key={a.id}>
                  {i > 0 ? <Separador /> : null}
                  <View style={{ padding: 16, gap: 6 }}>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <Etiqueta tono={TONO[est]} texto={ETIQUETA_ESTADO_LOCAL[est]} />
                      <Etiqueta
                        texto={`${ETIQUETA_TIPO[a.tipo]}${a.categoria === null ? '' : ` · ${ETIQUETA_CATEGORIA_LOGISTICA[a.categoria]}`}`}
                      />
                      {a.afecta_cronograma === 1 ? <Etiqueta texto="Afecta el cronograma" /> : null}
                    </View>
                    <Text style={T.subtitulo}>{a.titulo}</Text>
                    <Text style={T.suave}>
                      {[
                        a.estacion_id === null
                          ? null
                          : `Estación ${estaciones.get(a.estacion_id) ?? ''}`,
                        FORMATO.format(new Date(a.creado_en)),
                      ]
                        .filter((x) => x !== null)
                        .join(' · ')}
                    </Text>
                    {est === 'no_aceptada' ? (
                      <Text style={[T.cuerpo, { color: C.oxido }]}>{explicarMotivo(a.motivo)}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </Grupo>
        ) : null}
      </ScrollView>
      <AccionInferior abajo={insets.bottom}>
        <Boton texto="Registrar alerta" alPresionar={() => router.push('/alerta/nueva')} />
      </AccionInferior>
    </View>
  );
}
