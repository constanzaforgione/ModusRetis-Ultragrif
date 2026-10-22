// Términos de uso públicos (los piden Meta, LinkedIn y TikTok para aprobar la app de publicación)
import "../legal.css";

export const metadata = { title: "Términos · Planning Modus Retis" };

export const dynamic = "force-dynamic";

export default function Page() {
  const mail = process.env.LEGAL_CONTACT_EMAIL;
  return (
    <main className="legal">
      <h1>Términos de uso</h1>
      <p className="muted">Planning Modus Retis · Modus Retis Consulting · Buenos Aires, Argentina</p>
      <p>
        Planning Modus Retis es una herramienta interna de Modus Retis Consulting. Solo pueden usarla personas del equipo con una cuenta habilitada. Sirve para organizar tareas y proyectos, y
        para planificar y publicar contenido en las redes sociales de los clientes de Modus Retis, con su autorización.
      </p>
      <h2>Cuentas de redes</h2>
      <p>
        Las cuentas de Instagram, LinkedIn y TikTok se conectan con el permiso de sus dueños, y la app publica en ellas únicamente el contenido que el equipo programó. Cada red puede revocar el
        acceso en cualquier momento, y el cliente también, desde la configuración de su cuenta.
      </p>
      <h2>Contenido</h2>
      <p>El contenido publicado es responsabilidad de Modus Retis y de sus clientes, y respeta las normas de cada red.</p>
      <h2>Contacto</h2>
      <p>{mail ? <a href={`mailto:${mail}`}>{mail}</a> : "Escribinos al equipo de Modus Retis."}</p>
    </main>
  );
}
