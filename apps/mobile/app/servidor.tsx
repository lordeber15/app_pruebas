import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { CLAVES, llavero } from '../src/plataforma.ts';
import { Aviso, Boton, Campo, e, Texto, Titulo } from '../src/ui.tsx';

/** Solo https y sin ruta: https://dominio o https://dominio:puerto. */
const esServidorValido = (texto: string): boolean => {
  try {
    const u = new URL(texto);
    return (
      u.protocol === 'https:' &&
      (u.pathname === '/' || u.pathname === '') &&
      u.search === '' &&
      u.hash === ''
    );
  } catch {
    return false;
  }
};

/** Dirección del servidor de la instalación (una por empresa). Debe ser HTTPS. */
export default function Servidor() {
  const [url, setUrl] = useState('https://');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const guardar = async () => {
    setError(null);
    const limpia = url.trim().replace(/\/+$/, '');
    if (!esServidorValido(limpia)) {
      setError('Escriba la dirección completa con https://, por ejemplo https://demo.suempresa.pe');
      return;
    }
    setOcupado(true);
    try {
      const r = await fetch(`${limpia}/api/auth/get-session`);
      if (!r.ok) throw new Error('respuesta');
      await llavero.guardar(CLAVES.servidor, limpia);
      router.replace('/entrar');
    } catch {
      setError(
        'No se pudo conectar con esa dirección. Revise que esté bien escrita y que tenga conexión.',
      );
    } finally {
      setOcupado(false);
    }
  };

  return (
    <ScrollView
      style={e.pantalla}
      contentContainerStyle={e.contenido}
      keyboardShouldPersistTaps="handled"
    >
      <Titulo>Servidor de su empresa</Titulo>
      <Texto suave>
        Se configura una sola vez. Se la entrega el supervisor o el administrador.
      </Texto>
      <Campo
        etiqueta="Dirección"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {error === null ? null : <Aviso>{error}</Aviso>}
      <Boton texto="Guardar y continuar" alPresionar={() => void guardar()} ocupado={ocupado} />
    </ScrollView>
  );
}
