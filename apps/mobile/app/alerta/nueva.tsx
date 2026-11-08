import {
  CATEGORIAS_ALERTA_LOGISTICA,
  ETIQUETA_CATEGORIA_LOGISTICA,
  type CategoriaAlertaLogistica,
  type TipoAlertaRegistrable,
} from '@campo/core';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  brigadaSugerida,
  brigadasParaAlerta,
  ETIQUETA_TIPO,
  registrarAlerta,
  type BrigadaParaAlerta,
} from '../../src/alertas.ts';
import { ejecucion as leerEjecucion, leerPaquete } from '../../src/campo.ts';
import {
  AccionInferior,
  Aviso,
  BarraEstado,
  Boton,
  Campo,
  e,
  Segmentado,
  T,
  tipoOracion,
} from '../../src/ui.tsx';

interface Contexto {
  brigadas: BrigadaParaAlerta[];
  sugerida: string | null;
  estacion: { id: string; codigo: string } | null;
  ejecucion: { id: string; metodo: string; reservaId: string | null } | null;
}

/**
 * Registrar una alerta sin señal (D02 §9 y §13, RN-36). Desde la estación o la ejecución llega
 * vinculada a ellas; el tipo depende del rol en la brigada (técnica: especialista y supervisor;
 * logística: JdB, solo excepciones, E-07). Se guarda en el celular y se envía al haber conexión.
 */
export default function NuevaAlerta() {
  const params = useLocalSearchParams<{ estacionId?: string; ejecucionId?: string }>();
  const insets = useSafeAreaInsets();
  const [ctx, setCtx] = useState<Contexto | 'cargando' | 'sin_paquete'>('cargando');
  const [brigadaId, setBrigadaId] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoAlertaRegistrable | null>(null);
  const [categoria, setCategoria] = useState<CategoriaAlertaLogistica | null>(null);
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [vincular, setVincular] = useState<'si' | 'no'>('si');
  const [afecta, setAfecta] = useState<'si' | 'no'>('no');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const d = await leerPaquete();
        if (d === null) {
          setCtx('sin_paquete');
          return;
        }
        const p = d.paquete;
        const ej =
          params.ejecucionId === undefined ? null : await leerEjecucion(params.ejecucionId);
        const estacionId = ej?.estacion_id ?? params.estacionId ?? null;
        const est = p.estaciones.find((x) => x.id === estacionId) ?? null;
        const metodo = ej === null ? undefined : p.metodos.find((m) => m.id === ej.metodo_id);
        const brigadas = brigadasParaAlerta(p);
        const sugerida = brigadaSugerida(p, brigadas, estacionId, ej?.reserva_id ?? null);
        setCtx({
          brigadas,
          sugerida,
          estacion: est === null ? null : { id: est.id, codigo: est.codigo },
          ejecucion:
            ej === null
              ? null
              : {
                  id: ej.id,
                  metodo: tipoOracion(metodo?.nombre ?? 'Método'),
                  reservaId: ej.reserva_id,
                },
        });
        setBrigadaId((b) => b ?? sugerida);
      })();
    }, [params.ejecucionId, params.estacionId]),
  );

  if (ctx === 'cargando') return <View style={e.pantalla} />;
  if (ctx === 'sin_paquete' || ctx.brigadas.length === 0) {
    return (
      <View style={e.pantalla}>
        <BarraEstado />
        <View style={e.contenido}>
          <Aviso tipo="atencion">
            {ctx === 'sin_paquete'
              ? 'Descargue primero el paquete de campo de su brigada.'
              : 'Su rol en la brigada no registra alertas desde el celular.'}
          </Aviso>
        </View>
      </View>
    );
  }

  const brigada = ctx.brigadas.find((b) => b.id === brigadaId) ?? ctx.brigadas[0];
  const tipos = brigada?.tipos ?? [];
  const tipoVigente = tipo !== null && tipos.includes(tipo) ? tipo : (tipos[0] ?? null);
  const vinculo = ctx.ejecucion !== null || ctx.estacion !== null;
  const faltaCategoria = tipoVigente === 'logistica' && categoria === null;
  const listo =
    brigada !== undefined && tipoVigente !== null && titulo.trim() !== '' && !faltaCategoria;

  const guardar = async () => {
    if (brigada === undefined || tipoVigente === null) return;
    setGuardando(true);
    setError(null);
    try {
      const enlazar = vinculo && vincular === 'si';
      await registrarAlerta({
        brigadaId: brigada.id,
        tipo: tipoVigente,
        categoria: tipoVigente === 'logistica' ? categoria : null,
        titulo,
        descripcion,
        estacionId: enlazar ? (ctx.estacion?.id ?? null) : null,
        ejecucionId: enlazar ? (ctx.ejecucion?.id ?? null) : null,
        reservaId: enlazar ? (ctx.ejecucion?.reservaId ?? null) : null,
        afectaCronograma: afecta === 'si',
      });
      router.replace('/alertas');
    } catch {
      setError('No se pudo guardar la alerta. Revise los datos e intente de nuevo.');
      setGuardando(false);
    }
  };

  return (
    <View style={e.pantalla}>
      <Stack.Screen options={{ title: 'Registrar alerta' }} />
      <BarraEstado />
      <ScrollView
        contentContainerStyle={[e.contenido, { gap: 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={T.suave}>
          Solo excepciones: lo que está conforme no necesita alerta. Se guarda en este celular y se
          envía cuando haya conexión.
        </Text>
        {error === null ? null : <Aviso>{error}</Aviso>}

        {ctx.brigadas.length > 1 ? (
          <Segmentado
            etiqueta="Brigada"
            opciones={ctx.brigadas.map((b) => ({ valor: b.id, texto: b.nombre }))}
            valor={brigada?.id ?? null}
            alCambiar={setBrigadaId}
          />
        ) : null}

        {tipos.length > 1 ? (
          <Segmentado
            etiqueta="Tipo de alerta"
            opciones={tipos.map((t) => ({ valor: t, texto: ETIQUETA_TIPO[t] }))}
            valor={tipoVigente}
            alCambiar={setTipo}
          />
        ) : (
          <View style={{ gap: 4 }}>
            <Text style={T.etiqueta}>Tipo de alerta</Text>
            <Text style={T.subtitulo}>
              {tipoVigente === null
                ? '—'
                : tipoVigente === 'tecnica'
                  ? 'Técnica o metodológica'
                  : 'Logística'}
            </Text>
          </View>
        )}

        {tipoVigente === 'logistica' ? (
          <Segmentado
            etiqueta="Categoría"
            opciones={CATEGORIAS_ALERTA_LOGISTICA.map((c) => ({
              valor: c,
              texto: ETIQUETA_CATEGORIA_LOGISTICA[c],
            }))}
            valor={categoria}
            alCambiar={setCategoria}
          />
        ) : null}

        <Campo
          etiqueta="Qué pasó"
          value={titulo}
          onChangeText={setTitulo}
          maxLength={200}
          placeholder={
            tipoVigente === 'logistica' ? 'Ej.: la movilidad no llegó' : 'Ej.: trampa 4 inundada'
          }
        />
        <Campo
          etiqueta="Detalle (opcional)"
          value={descripcion}
          onChangeText={setDescripcion}
          maxLength={4000}
          multiline
          style={[e.entrada, { minHeight: 104, paddingTop: 12, textAlignVertical: 'top' }]}
        />

        {vinculo ? (
          <Segmentado
            etiqueta={
              ctx.ejecucion !== null
                ? `Vincular a ${ctx.ejecucion.metodo}${ctx.estacion === null ? '' : ` en ${ctx.estacion.codigo}`}`
                : `Vincular a la estación ${ctx.estacion?.codigo ?? ''}`
            }
            opciones={[
              { valor: 'si', texto: 'Sí' },
              { valor: 'no', texto: 'No' },
            ]}
            valor={vincular}
            alCambiar={setVincular}
          />
        ) : null}

        <Segmentado
          etiqueta="¿Afecta el cronograma?"
          opciones={[
            { valor: 'no', texto: 'No' },
            { valor: 'si', texto: 'Sí' },
          ]}
          valor={afecta}
          alCambiar={setAfecta}
        />
        {faltaCategoria ? <Text style={T.suave}>Elija la categoría logística.</Text> : null}
      </ScrollView>
      <AccionInferior abajo={insets.bottom}>
        <Boton
          texto="Guardar alerta"
          ocupado={guardando}
          deshabilitado={!listo}
          alPresionar={() => void guardar()}
        />
      </AccionInferior>
    </View>
  );
}
