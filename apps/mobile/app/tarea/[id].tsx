import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../src/estado.ts';
import {
  comentar,
  comentariosDe,
  completar,
  crearEvidencia,
  esfuerzoDe,
  evidenciasDe,
  fotosDe,
  metodologiaDe,
  registrarEsfuerzo,
  tarea as leerTarea,
  type TareaLocal,
} from '../../src/tareas.ts';
import { Aviso, BarraEstado, Boton, C, Campo, e, Texto, Titulo } from '../../src/ui.tsx';

type Datos = {
  t: TareaLocal;
  fotos: Awaited<ReturnType<typeof fotosDe>>;
  evidencias: Awaited<ReturnType<typeof evidenciasDe>>;
  esfuerzo: Awaited<ReturnType<typeof esfuerzoDe>>;
  comentarios: Awaited<ReturnType<typeof comentariosDe>>;
  metodologia: Awaited<ReturnType<typeof metodologiaDe>>;
};

const Seccion = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <View style={[e.tarjeta, { gap: 10 }]}>
    <Text style={{ fontSize: 18, fontWeight: '800', color: C.tinta }}>{titulo}</Text>
    {children}
  </View>
);

export default function Tarea() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const version = useApp((s) => s.version);
  const [d, setD] = useState<Datos | null>(null);
  const [punto, setPunto] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [fase, setFase] = useState('diurna');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const t = await leerTarea(id);
    if (t === null) return;
    const [fotos, evidencias, esfuerzo, comentarios, metodologia] = await Promise.all([
      fotosDe(id),
      evidenciasDe(id),
      esfuerzoDe(id),
      comentariosDe(id),
      metodologiaDe(t),
    ]);
    setD({ t, fotos, evidencias, esfuerzo, comentarios, metodologia });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar, version]),
  );

  if (d === null) return <View style={e.pantalla} />;
  const { t } = d;
  const editable = t.revocada === 0 && t.estado_local !== 'completada' && t.estado !== 'validada';
  const total = d.esfuerzo.reduce((s, x) => s + x.cantidad, 0);

  const intentar = (f: () => Promise<void>, ok?: string) => async () => {
    setError(null);
    setAviso(null);
    try {
      await f();
      if (ok !== undefined) setAviso(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    }
  };

  return (
    <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
      <BarraEstado />
      <ScrollView contentContainerStyle={e.contenido} keyboardShouldPersistTaps="handled">
        <Titulo>{t.titulo}</Titulo>
        {t.cuaderno_titulo === null ? null : <Texto suave>{t.cuaderno_titulo}</Texto>}
        {t.revocada === 1 ? (
          <Aviso>
            Esta tarea fue reasignada
            {t.motivo_revocacion === null ? '' : `: ${t.motivo_revocacion}`}. Lo que registre aquí
            quedará en revisión.
          </Aviso>
        ) : null}
        {t.estado_local === 'completada' ? (
          <Aviso tipo="ok">
            {t.estado === 'completada' || t.estado === 'validada'
              ? 'Completada y recibida por el servidor.'
              : 'Completada. Se enviará al tener conexión.'}
          </Aviso>
        ) : null}
        {error === null ? null : <Aviso>{error}</Aviso>}
        {aviso === null ? null : <Aviso tipo="ok">{aviso}</Aviso>}

        {t.descripcion === null ? null : (
          <Seccion titulo="Indicaciones">
            <Texto>{t.descripcion}</Texto>
          </Seccion>
        )}

        <Seccion titulo="Fotos de evidencia">
          {d.fotos.length === 0 ? (
            <Texto suave>
              Todavía no hay fotos. Para completar la tarea necesita al menos una.
            </Texto>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {d.fotos.map((f) => (
              <View key={f.id} style={{ width: 96, gap: 4 }}>
                {f.estado === 'verificado' ? (
                  <View
                    style={{
                      width: 96,
                      height: 72,
                      borderRadius: 6,
                      backgroundColor: C.liquenClaro,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: C.liquenOscuro, fontWeight: '700' }}>Recibida</Text>
                  </View>
                ) : (
                  <Image
                    source={{ uri: f.uri }}
                    style={{ width: 96, height: 72, borderRadius: 6 }}
                    accessibilityLabel="Foto de evidencia"
                  />
                )}
                <Text style={{ fontSize: 12, color: C.suave }}>
                  {f.estado === 'verificado'
                    ? 'En el servidor'
                    : f.estado === 'subido'
                      ? 'Verificando'
                      : 'Por enviar'}
                </Text>
              </View>
            ))}
          </View>
          {editable ? (
            <Boton
              texto="Tomar foto"
              alPresionar={() => router.push({ pathname: '/camara', params: { tareaId: t.id } })}
            />
          ) : null}
        </Seccion>

        <Seccion titulo="Puntos de evidencia">
          {d.evidencias.length === 0 ? (
            <Texto suave>Opcional. Cree un punto por cada trampa, parcela o registro.</Texto>
          ) : null}
          {d.evidencias.map((p) => (
            <View
              key={p.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <Texto>{p.descripcion}</Texto>
              {editable ? (
                <Boton
                  texto="Foto"
                  variante="secundario"
                  alPresionar={() =>
                    router.push({
                      pathname: '/camara',
                      params: { tareaId: t.id, evidenciaId: p.id },
                    })
                  }
                />
              ) : null}
            </View>
          ))}
          {editable ? (
            <>
              <Campo
                etiqueta="Nuevo punto"
                value={punto}
                onChangeText={setPunto}
                placeholder="Ej.: Trampa 3"
              />
              <Boton
                texto="Agregar punto"
                variante="secundario"
                deshabilitado={punto.trim() === ''}
                alPresionar={() =>
                  void intentar(async () => {
                    await crearEvidencia(t, punto.trim());
                    setPunto('');
                  })()
                }
              />
            </>
          ) : null}
        </Seccion>

        {d.metodologia === null ? null : (
          <Seccion titulo={`Esfuerzo: ${d.metodologia.nombre}`}>
            <Texto>
              Registrado por usted: {total} {d.metodologia.unidad}
              {d.metodologia.meta_esfuerzo === null
                ? ''
                : ` (meta de la estación: ${String(d.metodologia.meta_esfuerzo)})`}
            </Texto>
            {editable ? (
              <>
                <Campo
                  etiqueta={`Cantidad (${d.metodologia.unidad})`}
                  value={cantidad}
                  onChangeText={setCantidad}
                  keyboardType="decimal-pad"
                />
                <Campo
                  etiqueta="Fase"
                  value={fase}
                  onChangeText={setFase}
                  ayuda="Ej.: diurna, nocturna"
                />
                <Boton
                  texto="Registrar esfuerzo"
                  variante="secundario"
                  deshabilitado={
                    !(Number(cantidad.replace(',', '.')) >= 0) ||
                    cantidad.trim() === '' ||
                    fase.trim() === ''
                  }
                  alPresionar={() =>
                    void intentar(async () => {
                      const m = d.metodologia;
                      if (m === null) return;
                      await registrarEsfuerzo(
                        t,
                        m.id,
                        fase.trim(),
                        Number(cantidad.replace(',', '.')),
                      );
                      setCantidad('');
                    }, 'Esfuerzo guardado.')()
                  }
                />
              </>
            ) : null}
          </Seccion>
        )}

        <Seccion titulo="Comentarios">
          {d.comentarios.length === 0 ? <Texto suave>Sin comentarios.</Texto> : null}
          {d.comentarios.map((c) => (
            <View
              key={c.id}
              style={{
                borderLeftWidth: 3,
                borderLeftColor: c.propio === 1 ? C.linea : C.ocre,
                paddingLeft: 10,
              }}
            >
              <Texto>{c.texto}</Texto>
              <Text style={{ fontSize: 12, color: C.suave }}>
                {c.propio === 1 ? 'Usted' : 'Supervisión'}
              </Text>
            </View>
          ))}
          <Campo etiqueta="Agregar comentario" value={nota} onChangeText={setNota} multiline />
          <Boton
            texto="Guardar comentario"
            variante="secundario"
            deshabilitado={nota.trim() === ''}
            alPresionar={() =>
              void intentar(async () => {
                await comentar(t, nota.trim());
                setNota('');
              })()
            }
          />
        </Seccion>

        {editable ? (
          <View style={{ gap: 8 }}>
            {d.fotos.length === 0 ? (
              <Texto suave>Para completar, tome al menos una foto con la cámara de la app.</Texto>
            ) : null}
            <Boton
              texto="Completar tarea"
              deshabilitado={d.fotos.length === 0}
              alPresionar={() =>
                void intentar(
                  () => completar(t),
                  'Tarea completada. Se enviará al tener conexión.',
                )()
              }
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
