import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { AvisoError, Boton, Campo, claseEntrada } from '../componentes/Ui.tsx';

const TIPOS = [
  { valor: 'DNI', texto: 'DNI' },
  { valor: 'CE', texto: 'Carné de extranjería' },
  { valor: 'PAS', texto: 'Pasaporte' },
];

export const Entrar = () => {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const [tipo, setTipo] = useState('DNI');
  const [numero, setNumero] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (ev: React.SyntheticEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      await api.entrar(`${tipo}.${numero.trim()}`.toLowerCase(), clave);
      await qc.invalidateQueries({ queryKey: ['yo'] });
      await navegar({ to: '/' });
    } catch (e) {
      setError(e);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="grid min-h-dvh md:grid-cols-[1fr_minmax(24rem,32rem)]">
      <section
        className="hidden flex-col justify-end bg-liquen-oscuro p-12 text-white md:flex"
        aria-hidden="true"
      >
        <svg viewBox="0 0 400 260" className="mb-10 w-full max-w-md opacity-80">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path
              key={i}
              d={`M0 ${String(200 - i * 22)} C 90 ${String(150 - i * 25)}, 180 ${String(230 - i * 20)}, 260 ${String(170 - i * 24)} S 380 ${String(120 - i * 18)}, 400 ${String(140 - i * 22)}`}
              fill="none"
              stroke="#e3ede8"
              strokeWidth="1.2"
            />
          ))}
          <path d="M248 118 L262 132 L248 146 L234 132 Z" fill="#a86f1e" />
          <circle cx="120" cy="150" r="7" fill="#e3ede8" />
          <circle cx="330" cy="92" r="7" fill="none" stroke="#e3ede8" strokeWidth="2" />
        </svg>
        <p className="max-w-sm text-xl font-semibold leading-snug">
          Estaciones, métodos y ejecuciones de las brigadas, desde el campo hasta su revisión.
        </p>
      </section>
      <section className="flex items-center justify-center bg-hoja px-6 py-12">
        <form
          onSubmit={(ev) => void enviar(ev)}
          className="flex w-full max-w-sm flex-col gap-4"
          noValidate
        >
          <h1 className="text-2xl font-bold">Ingrese a la plataforma</h1>
          <p className="text-sm text-tinta-suave">
            Use su documento y su contraseña. Si es su primer ingreso, use la contraseña temporal
            que le entregaron: le pedirá crear una propia.
          </p>
          <Campo etiqueta="Tipo de documento">
            {(id) => (
              <select
                id={id}
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className={claseEntrada}
              >
                {TIPOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.texto}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo etiqueta="Número de documento">
            {(id) => (
              <input
                id={id}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                inputMode="text"
                autoComplete="username"
                required
                className={claseEntrada}
              />
            )}
          </Campo>
          <Campo etiqueta="Contraseña">
            {(id) => (
              <input
                id={id}
                type="password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                autoComplete="current-password"
                required
                className={claseEntrada}
              />
            )}
          </Campo>
          <AvisoError error={error} />
          <Boton type="submit" ocupado={ocupado} disabled={numero.trim() === '' || clave === ''}>
            Ingresar
          </Boton>
        </form>
      </section>
    </div>
  );
};
