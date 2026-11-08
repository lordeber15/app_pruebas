import type { EvaluacionEjecucion, TipoUnidad } from '@campo/core';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ejecucion as leerEjecucion,
  evaluarLocal,
  fotosDeEjecucion,
  fotosMinimasEjecucion,
  leerPaquete,
  nuevaUnidad,
  unidadesDe,
  type EjecucionLocal,
  type EstacionPaquete,
  type MetodoPaquete,
  type UnidadLocal,
} from '../../src/campo.ts';
import { useApp } from '../../src/estado.ts';
import { mayuscula, NOMBRE_UNIDAD, sinCodigo } from '../../src/textos.ts';
import {
  AccionInferior,
  Aviso,
  Avance,
  BarraEstado,
  Boton,
  e,
  Etiqueta,
  Fila,
  Grupo,
  MarcaControl,
  Separador,
  T,
  tipoOracion,
} from '../../src/ui.tsx';

interface Datos {
  ej: EjecucionLocal;
  metodo: MetodoPaquete;
  estacion: EstacionPaquete;
  unidades: UnidadLocal[];
  evaluacion: EvaluacionEjecucion;
  metodologicas: number;
  /** Fotos propias de la ejecución y de sus unidades, de cualquier tipo. */
  fotosTotales: number;
  /** Foto mínima por ejecución del proyecto (RN-04 ampliada, 2026-11-08). */
  fotosMinimas: number;
}

/** Estado de una unidad en una línea: lo primero que falta, o que está completa. */
const EstadoUnidad = ({ u, ev }: { u: UnidadLocal; ev: EvaluacionEjecucion }) => {
  const propios = ev.resultados.filter((r) => r.unidad_id === u.id && r.estado === 'incumple');
  const obligatorio = propios.find((r) => r.tipo_control === 'obligatorio');
  const aviso = propios.find((r) => r.tipo_control === 'advertencia');
  if (u.estado === 'abierta') {
    return (
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Etiqueta tono="atencion" texto="Abierta" />
        {obligatorio === undefined ? null : (
          <Text style={[T.suave, { flex: 1 }]} numberOfLines={1}>
            {mayuscula(sinCodigo(obligatorio.mensaje, u.codigo))}
          </Text>
        )}
      </View>
    );
  }
  if (obligatorio !== undefined) {
    return (
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <MarcaControl control="obligatorio" />
        <Text style={[T.suave, { flex: 1 }]} numberOfLines={2}>
          Falta: {sinCodigo(obligatorio.mensaje, u.codigo)}
        </Text>
      </View>
    );
  }
  if (aviso !== undefined) {
    return (
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <MarcaControl control="advertencia" />
        <Text style={[T.suave, { flex: 1 }]} numberOfLines={2}>
          {sinCodigo(aviso.mensaje, u.codigo)}
        </Text>
      </View>
    );
  }
  return <Etiqueta tono="ok" texto="Completa" />;
};

export default function Ejecucion() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const version = useApp((s) => s.version);
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const p = await leerPaquete();
        const ej = await leerEjecucion(id);
        if (p === null || ej === null) return;
        const ev = await evaluarLocal(p.paquete, id);
        if (ev === null) return;
        const fotos = await fotosDeEjecucion(id);
        setD({
          ej,
          metodo: ev.metodo,
          estacion: ev.estacion,
          unidades: await unidadesDe(id),
          evaluacion: ev.evaluacion,
          metodologicas: fotos.filter((f) => f.tipo_foto === 'metodologica').length,
          fotosTotales: fotos.length,
          fotosMinimas: fotosMinimasEjecucion(p.paquete, ev.estacion.proyecto_id),
        });
      })();
    }, [id, version]),
  );

  if (d === null) return <View style={e.pantalla} />;
  const cfg = d.metodo.config;
  const cerrada = d.ej.estado_local === 'cerrada';
  const tipos: TipoUnidad[] = [cfg.unidad.tipo, ...cfg.unidad.tipos_adicionales];
  const minimoMet = cfg.fotos.metodologicas.minimo;
  const o = d.evaluacion.objetivo;

  const agregar = async (tipo: TipoUnidad) => {
    setError(null);
    try {
      const uid = await nuevaUnidad(id, tipo);
      router.push({ pathname: '/unidad/[id]', params: { id: uid } });
    } catch {
      setError('No se pudo crear la unidad. Intente de nuevo.');
    }
  };

  return (
    <View style={e.pantalla}>
      <Stack.Screen options={{ title: `${d.estacion.codigo} · Ejecución` }} />
      <BarraEstado />
      <ScrollView contentContainerStyle={[e.contenido, { gap: 22 }]}>
        <View style={{ gap: 6 }}>
          <Text style={T.titulo}>{tipoOracion(cfg.nombre)}</Text>
          {cerrada ? (
            <Aviso tipo={(d.ej.incumplimientos ?? 0) > 0 ? 'atencion' : 'ok'}>
              {(d.ej.incumplimientos ?? 0) > 0
                ? 'Cerrada con faltantes declarados. Se enviará al tener conexión.'
                : 'Cerrada. Se enviará al tener conexión.'}
            </Aviso>
          ) : null}
        </View>
        {error === null ? null : <Aviso>{error}</Aviso>}

        <View style={[e.tarjeta, { gap: 8 }]}>
          <Text style={T.etiqueta}>
            {o.origen === 'referencia' ? 'Esfuerzo de referencia' : 'Objetivo'}
          </Text>
          <Avance
            ejecutado={d.evaluacion.avance.ejecutado}
            objetivo={o.cantidad}
            unidad={o.unidad_texto}
          />
          {o.origen === 'referencia' ? (
            <Text style={T.suave}>Usted define el número final al cerrar.</Text>
          ) : null}
        </View>

        <Grupo
          titulo="Unidades"
          nota={
            d.unidades.length === 0
              ? `Agregue la primera ${NOMBRE_UNIDAD[cfg.unidad.tipo]}.`
              : undefined
          }
        >
          {d.unidades.map((u, i) => (
            <View key={u.id}>
              {i > 0 ? <Separador /> : null}
              <Fila
                alPresionar={() => router.push({ pathname: '/unidad/[id]', params: { id: u.id } })}
                etiquetaAccesible={`Unidad ${u.codigo}`}
              >
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
                  <Text style={T.subtitulo}>{u.codigo}</Text>
                  <Text style={T.suave}>{NOMBRE_UNIDAD[u.tipo_unidad]}</Text>
                </View>
                <EstadoUnidad u={u} ev={d.evaluacion} />
              </Fila>
            </View>
          ))}
          {d.unidades.length === 0 ? <View style={{ height: 1 }} /> : null}
        </Grupo>

        {cerrada ? null : (
          <View style={{ gap: 8 }}>
            {tipos.map((t, i) => (
              <Boton
                key={t}
                variante={i === 0 ? 'principal' : 'secundario'}
                texto={`Agregar ${NOMBRE_UNIDAD[t]}`}
                alPresionar={() => void agregar(t)}
              />
            ))}
          </View>
        )}

        {minimoMet > 0 ? (
          <View style={[e.tarjeta, { gap: 8 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MarcaControl control="obligatorio" />
              <Text style={[T.subtitulo, { flex: 1 }]}>Fotos metodológicas</Text>
              <Text style={T.dato}>
                {d.metodologicas} de {minimoMet}
              </Text>
            </View>
            <Text style={T.suave}>{cfg.fotos.metodologicas.texto}</Text>
            {cerrada ? null : (
              <Boton
                variante="secundario"
                texto="Tomar foto metodológica"
                alPresionar={() =>
                  router.push({
                    pathname: '/camara',
                    params: { ejecucionId: id, tipoFoto: 'metodologica' },
                  })
                }
              />
            )}
          </View>
        ) : null}
        {/* RN-04 ampliada (2026-11-08): toda ejecución, también un EVENTO, lleva al menos N
            fotos. Si D01 ya pide esas fotos metodológicas, basta la tarjeta de arriba. */}
        {d.fotosMinimas > 0 && minimoMet < d.fotosMinimas ? (
          <View style={[e.tarjeta, { gap: 8 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MarcaControl control="obligatorio" />
              <Text style={[T.subtitulo, { flex: 1 }]}>Fotos de la ejecución</Text>
              <Text style={T.dato}>
                {d.fotosTotales} de {d.fotosMinimas}
              </Text>
            </View>
            <Text style={T.suave}>
              Toda ejecución requiere al menos {d.fotosMinimas}{' '}
              {d.fotosMinimas === 1 ? 'foto georreferenciada' : 'fotos georreferenciadas'} (decisión
              del proyecto). Cuentan todas las fotos de la ejecución y de sus unidades.
            </Text>
            {cerrada ? null : (
              <Boton
                variante={d.fotosTotales < d.fotosMinimas ? 'principal' : 'secundario'}
                texto="Tomar foto"
                alPresionar={() =>
                  router.push({
                    pathname: '/camara',
                    params: {
                      ejecucionId: id,
                      // Un registro oportuno documenta al individuo; otro método, su entorno.
                      tipoFoto: cfg.clase === 'evento' ? 'primer_plano' : 'contexto',
                    },
                  })
                }
              />
            )}
          </View>
        ) : null}
        <Boton
          variante="secundario"
          texto="Registrar alerta de esta ejecución"
          alPresionar={() =>
            router.push({ pathname: '/alerta/nueva', params: { ejecucionId: id } })
          }
        />
      </ScrollView>
      {cerrada ? null : (
        <AccionInferior abajo={insets.bottom}>
          <Boton
            texto={
              d.evaluacion.incumplimientos_obligatorios > 0
                ? `Revisar y cerrar (${String(d.evaluacion.incumplimientos_obligatorios)} pendientes)`
                : 'Revisar y cerrar'
            }
            variante={d.evaluacion.incumplimientos_obligatorios > 0 ? 'secundario' : 'principal'}
            deshabilitado={d.unidades.length === 0 && cfg.clase !== 'evento'}
            alPresionar={() => router.push({ pathname: '/cierre/[id]', params: { id } })}
          />
        </AccionInferior>
      )}
    </View>
  );
}
