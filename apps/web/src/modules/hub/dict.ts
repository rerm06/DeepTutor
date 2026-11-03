import { defineDict, useModuleT } from "../i18n";

/** ES/EN strings for the hub pages (AI agents, help). Copy rule (Ley 82): never use the regulated nutrition titles. */
export const dict = defineDict({
  es: {
    "nav.ai": "Agentes IA",
    "nav.help": "Ayuda y Academia",
    "ai.title": "Agentes IA",
    "ai.lede":
      "Asistentes que trabajan con los datos de tu gimnasio. Cada uno pide confirmación antes de actuar y respeta los consentimientos del socio.",
    "ai.status.on": "Activo",
    "ai.status.demo": "Modo demo",
    "ai.status.soon": "Próximamente",
    "ai.coach.title": "Coach IA del socio",
    "ai.coach.body":
      "Check-in diario, memoria del socio y recomendaciones de entrenamiento. Escala a una persona ante señales de riesgo.",
    "ai.coach.demo": "Responde con reglas deterministas hasta que configures una clave de API.",
    "ai.coach.on": "Proveedor: {provider}",
    "ai.reminders.title": "Recordatorios y cobranza",
    "ai.reminders.body":
      "Mensajes de clase, vencimientos y saldos pendientes con plantillas aprobadas, solo a socios con consentimiento y en horario permitido.",
    "ai.reminders.note": "En la demo los mensajes quedan en cola; no se envían.",
    "ai.sales.title": "Ventas y atención por WhatsApp",
    "ai.sales.body": "Responde preguntas de prospectos, agenda visitas y crea leads en el CRM.",
    "ai.sales.note": "Requiere credenciales de Twilio/WhatsApp (pendientes).",
    "ai.voice.title": "Agente de voz",
    "ai.voice.body": "Llamadas de seguimiento a socios que lo autoricen por escrito.",
    "ai.voice.note": "Requiere consentimiento escrito previo (TCPA) y revisión legal.",
    "ai.open": "Abrir",
    "help.title": "Ayuda y Academia",
    "help.titleMember": "Ayuda y Soporte",
    "help.guides": "Guías rápidas",
    "help.shortcuts": "Atajos",
    "help.tile.membership": "Comprar mi sesión",
    "help.tile.classes": "Reservar una clase",
    "help.tile.credential": "Mi credencial QR",
    "help.tile.coach": "Hablar con el Coach IA",
    "ai.agents": "Asistentes disponibles",
    "help.lede": "Guías cortas para las tareas de todos los días.",
    "help.checkin.title": "Registrar un check-in",
    "help.checkin.body":
      "En Inicio o en Agenda / Clases › Check-in rápido, busca al socio por nombre, correo o número y toca «Entrada». Si no tiene sesiones disponibles verás el motivo.",
    "help.sell.title": "Vender una sesión",
    "help.sell.body":
      "En Pagos y POS, elige la sesión suelta o el paquete, confirma el IVU que calcula el sistema y cobra. El recibo queda en la ficha del socio.",
    "help.class.title": "Crear una clase",
    "help.class.body":
      "En Agenda / Clases, crea la clase con sede, sala, horario y cupo. Los socios la reservan desde su portal y la lista de espera se llena sola.",
    "help.join.title": "Invitar a un socio a registrarse",
    "help.join.body":
      "Comparte el enlace «Únete» de tu marca. El socio elige su sede, acepta los términos y entra a su portal sin pagar matrícula.",
    "help.panel.title": "Leer el panel",
    "help.panel.body":
      "Cada cifra sale de los registros que tu rol puede ver. Usa el selector de sede de la cabecera y abre «Ver datos en tabla» bajo cada gráfica.",
    "help.member.title": "Tu portal de socio",
    "help.member.body":
      "Compra tu sesión, reserva clases y muestra tu credencial QR en la entrada. El Coach IA te acompaña cada día.",
  },
  en: {
    "nav.ai": "AI agents",
    "nav.help": "Help & Academy",
    "ai.title": "AI agents",
    "ai.lede":
      "Assistants that work with your gym's data. Each one asks for confirmation before acting and honours each member's consent.",
    "ai.status.on": "Active",
    "ai.status.demo": "Demo mode",
    "ai.status.soon": "Coming soon",
    "ai.coach.title": "Member AI coach",
    "ai.coach.body":
      "Daily check-in, member memory and training suggestions. Hands off to a person when it sees a risk signal.",
    "ai.coach.demo": "Answers with deterministic rules until you set an API key.",
    "ai.coach.on": "Provider: {provider}",
    "ai.reminders.title": "Reminders and collections",
    "ai.reminders.body":
      "Class, expiry and balance messages from approved templates, only to members who consented and within allowed hours.",
    "ai.reminders.note": "In the demo, messages are queued, not sent.",
    "ai.sales.title": "Sales and WhatsApp support",
    "ai.sales.body": "Answers leads' questions, books visits and creates CRM leads.",
    "ai.sales.note": "Needs Twilio/WhatsApp credentials (pending).",
    "ai.voice.title": "Voice agent",
    "ai.voice.body": "Follow-up calls to members who authorised them in writing.",
    "ai.voice.note": "Needs prior written consent (TCPA) and legal review.",
    "ai.open": "Open",
    "help.title": "Help & Academy",
    "help.titleMember": "Help & Support",
    "help.guides": "Quick guides",
    "help.shortcuts": "Shortcuts",
    "help.tile.membership": "Buy my session",
    "help.tile.classes": "Book a class",
    "help.tile.credential": "My QR credential",
    "help.tile.coach": "Talk to the AI coach",
    "ai.agents": "Available assistants",
    "help.lede": "Short guides for everyday tasks.",
    "help.checkin.title": "Check a member in",
    "help.checkin.body":
      "From Home or Schedule / Classes › Quick check-in, search by name, email or number and tap “Check in”. If they have no sessions left you will see why.",
    "help.sell.title": "Sell a session",
    "help.sell.body":
      "In Payments & POS, pick the single session or pack, confirm the IVU the system computes and charge. The receipt lands on the member's record.",
    "help.class.title": "Create a class",
    "help.class.body":
      "In Schedule / Classes, create the class with location, room, time and capacity. Members book from their portal and the waitlist fills itself.",
    "help.join.title": "Invite a member to sign up",
    "help.join.body":
      "Share your brand's “Join” link. The member picks a location, accepts the terms and lands in their portal with no enrolment fee.",
    "help.panel.title": "Read the dashboard",
    "help.panel.body":
      "Every number comes from the records your role can see. Use the location picker in the header and open “Show data table” under each chart.",
    "help.member.title": "Your member portal",
    "help.member.body":
      "Buy your session, book classes and show your QR credential at the door. The AI coach is with you every day.",
  },
});

export type HubKey = keyof (typeof dict)["es"];
export const useHubT = () => useModuleT(dict);
