import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../src/estado.ts';
import { definirPin, PIN_VALIDO } from '../src/pin.ts';
import { FormularioContrasena } from '../src/contrasena.tsx';
import { activarDispositivo, debeCambiarContrasena, entrar, ErrorServidor } from '../src/sesion.ts';
import { sincronizar } from '../src/sync.ts';
import { Aviso, Boton, C, Campo, e, Texto, Titulo } from '../src/ui.tsx';

const TIPOS = [
  { valor: 'DNI', texto: 'DNI' },
  { valor: 'CE', texto: 'CE' },
  { valor: 'PAS', texto: 'Pasaporte' },
];

/**
 * Primer ingreso en línea (RF-M01): documento y contraseña; si es la temporal, crear una propia;
 * activación del celular y PIN.
 */
export default function Entrar() {
  const [paso, setPaso] = useState<'credenciales' | 'contrasena' | 'pin'>('credenciales');
  const [tipo, setTipo] = useState('DNI');
  const [numero, setNumero] = useState('');
  const [clave, setClave] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const ingresar = async () => {
    setError(null);
    setOcupado(true);
    try {
      await entrar(tipo, numero, clave);
      if (await debeCambiarContrasena()) {
        setPaso('contrasena');
        return;
      }
      await activar();
    } catch (err) {
      setError(
        err instanceof ErrorServidor
          ? err.message
          : 'No se pudo activar el celular. Intente de nuevo.',
      );
    } finally {
      setOcupado(false);
    }
  };

  const activar = async () => {
    await activarDispositivo(Constants.expoConfig?.version ?? '0.1.0');
    setPaso('pin');
  };

  const guardarPin = async () => {
    setError(null);
    if (!PIN_VALIDO.test(pin)) {
      setError('El PIN debe tener 6 dígitos.');
      return;
    }
    if (pin !== pin2) {
      setError('Los dos PIN no coinciden.');
      return;
    }
    await definirPin(pin);
    useApp.setState({ desbloqueado: true });
    void sincronizar();
    router.replace('/');
  };

  if (paso === 'contrasena') {
    return (
      <ScrollView
        style={e.pantalla}
        contentContainerStyle={e.contenido}
        keyboardShouldPersistTaps="handled"
      >
        <Titulo>Cree su contraseña</Titulo>
        <Texto suave>
          Entró con una contraseña temporal. Elija una propia para continuar; la temporal deja de
          servir.
        </Texto>
        <FormularioContrasena
          actualConocida={clave}
          alTerminar={async () => {
            setClave('');
            await activar();
          }}
        />
      </ScrollView>
    );
  }

  if (paso === 'pin') {
    return (
      <ScrollView
        style={e.pantalla}
        contentContainerStyle={e.contenido}
        keyboardShouldPersistTaps="handled"
      >
        <Titulo>Defina su PIN</Titulo>
        <Texto suave>Con este PIN de 6 dígitos abrirá la app aunque no tenga señal.</Texto>
        <Campo
          etiqueta="PIN"
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
        />
        <Campo
          etiqueta="Repita el PIN"
          value={pin2}
          onChangeText={setPin2}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
        />
        {error === null ? null : <Aviso>{error}</Aviso>}
        <Boton texto="Guardar PIN" alPresionar={() => void guardarPin()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={e.pantalla}
      contentContainerStyle={e.contenido}
      keyboardShouldPersistTaps="handled"
    >
      <Titulo>Ingrese con su documento</Titulo>
      <Texto suave>
        El primer ingreso necesita conexión. Use la contraseña temporal que le entregaron: luego
        creará una propia.
      </Texto>
      <View style={{ gap: 6 }}>
        <Text style={e.etiqueta}>Tipo de documento</Text>
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
          {TIPOS.map((t) => (
            <Pressable
              key={t.valor}
              accessibilityRole="radio"
              accessibilityState={{ selected: tipo === t.valor }}
              onPress={() => setTipo(t.valor)}
              style={[
                e.boton,
                {
                  flex: 1,
                  backgroundColor: tipo === t.valor ? C.liquenClaro : C.hoja,
                  borderColor: tipo === t.valor ? C.liquen : C.linea,
                  borderWidth: tipo === t.valor ? 2 : 1,
                },
              ]}
            >
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.tinta }}>{t.texto}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Campo
        etiqueta="Número de documento"
        value={numero}
        onChangeText={setNumero}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Campo
        etiqueta="Contraseña"
        value={clave}
        onChangeText={setClave}
        secureTextEntry
        autoCapitalize="none"
      />
      {error === null ? null : <Aviso>{error}</Aviso>}
      <Boton
        texto="Ingresar"
        alPresionar={() => void ingresar()}
        ocupado={ocupado}
        deshabilitado={numero.trim() === '' || clave === ''}
      />
    </ScrollView>
  );
}
