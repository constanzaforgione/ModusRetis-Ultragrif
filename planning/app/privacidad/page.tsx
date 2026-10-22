// Política de privacidad pública (la piden Meta, LinkedIn y TikTok para aprobar la app de publicación)
import "../legal.css";

export const metadata = { title: "Privacidad · Planning Modus Retis" };

export const dynamic = "force-dynamic";

export default function Page() {
  const mail = process.env.LEGAL_CONTACT_EMAIL;
  return (
    <main className="legal">
      <h1>Política de privacidad</h1>
      <p className="muted">Planning Modus Retis · Modus Retis Consulting · Buenos Aires, Argentina</p>
      <p>
        Planning Modus Retis es la herramienta interna de Modus Retis Consulting para planificar y publicar el contenido de redes sociales de sus clientes. La usan solo personas del equipo de
        Modus Retis.
      </p>
      <h2>Qué datos usamos</h2>
      <ul>
        <li>Al conectar una cuenta de Instagram, LinkedIn o TikTok guardamos el identificador de la cuenta, su nombre de usuario, su foto de perfil y los permisos (tokens) que la red entrega.</li>
        <li>Guardamos el contenido que el equipo programa: textos, hashtags, fotos, videos y documentos, y el resultado de cada publicación.</li>
        <li>No leemos mensajes privados, no recolectamos datos de seguidores y no vendemos ni compartimos información con terceros.</li>
      </ul>
      <h2>Para qué</h2>
      <p>Únicamente para publicar en la cuenta conectada el contenido que el equipo programó, en la fecha y hora indicadas, y mostrar si se publicó.</p>
      <h2>Dónde se guardan</h2>
      <p>En la base de datos y el almacenamiento de la app (Supabase). Los permisos de las cuentas solo los usa el servidor; nadie del equipo puede verlos.</p>
      <h2>Cómo borrar los datos</h2>
      <p>
        Desconectar una cuenta desde la app (RRSS → Cuentas) borra sus permisos de inmediato. También se puede quitar el acceso desde la configuración de cada red. Para pedir que borremos
        cualquier dato, escribinos{mail ? (
          <>
            {" "}a <a href={`mailto:${mail}`}>{mail}</a>
          </>
        ) : " al equipo de Modus Retis"}{" "}
        y lo hacemos dentro de los 30 días.
      </p>
    </main>
  );
}
