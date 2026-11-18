import { idempotent, prisma } from "./db";
import { subscribe } from "./events";
import { NotificationType } from "./generated/prisma/client";
import { callService, shortId } from "./http";

const PRODUCER_URL = process.env.PRODUCER_SERVICE_URL;
const AUTH_URL = process.env.AUTH_SERVICE_URL;

interface Message {
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}

export const uniqueRecipients = (userIds: (string | undefined)[]) => [...new Set(userIds.filter((id): id is string => !!id))];

async function notify(userIds: (string | undefined)[], n: Message) {
  const ids = uniqueRecipients(userIds);
  if (ids.length) await prisma.notification.createMany({ data: ids.map((userId) => ({ ...n, userId })) });
}

async function ownerOf(producerId: string) {
  const p = await callService<{ ownerId: string }>(PRODUCER_URL, `/producers/${encodeURIComponent(producerId)}`).catch(() => null);
  return p?.ownerId;
}

async function admins() {
  const users = await callService<{ id: string; role: string }[]>(AUTH_URL, "/auth/users");
  return users.filter((u) => u.role === "ADMIN").map((u) => u.id);
}

export const cop = (n: number) => `${Math.round(n).toLocaleString("es-CO")} COP`;

const EVENTS = [
  "user.registered",
  "inventory.reserved",
  "inventory.insufficient",
  "inventory.released",
  "order.cancelled",
  "payment.authorized",
  "payment.declined",
  "delivery.in_transit",
  "delivery.completed",
  "delivery.failed",
  "coldchain.breach",
  "settlement.available",
  "settlement.paid",
];

export async function registerConsumers() {
  await subscribe(
    "notification-service",
    EVENTS,
    idempotent(async ({ eventType, data }) => {
      const order = data.orderId ? shortId(data.orderId) : "";
      switch (eventType) {
        case "user.registered": {
          const producer = data.role === "PRODUCER";
          return notify([data.userId], {
            type: "SYSTEM",
            title: "¡Bienvenido a FarmToTable!",
            body: producer ? "Registra tu granja y tus productos para empezar a vender." : "Explora el catálogo de temporada.",
            link: producer ? "/productor" : "/catalogo",
          });
        }
        case "inventory.reserved":
          return notify([data.buyerId], {
            type: "ORDER",
            title: `Pedido ${order} confirmado`,
            body: "Reservamos el producto más fresco para ti. Paga para programar la entrega.",
            link: "/pedidos",
          });
        case "inventory.insufficient": {
          const names = (data.missing as { productId: string; productName?: string }[]).map((m) => m.productName ?? m.productId);
          return notify([data.buyerId], {
            type: "ORDER",
            title: `Pedido ${order} rechazado`,
            body: `Stock insuficiente: ${names.join(", ")}`,
            link: "/pedidos",
          });
        }
        case "inventory.released":
          if (data.cause !== "manual") return;
          return notify([data.buyerId], {
            type: "ORDER",
            title: `Pedido ${order} cancelado`,
            body: "La reserva de inventario fue liberada",
            link: "/pedidos",
          });
        case "order.cancelled":
          if (data.previousStatus === "CANCELLED") return;
          return notify([data.buyerId], {
            type: "ORDER",
            title: `Pedido ${order} cancelado`,
            body: data.previousStatus === "PAID" ? "Se devolvió el pago a tu medio original." : "El stock reservado fue liberado.",
            link: "/pedidos",
          });
        case "payment.authorized": {
          const producers = [...new Set((data.items as { producerId: string }[]).map((i) => i.producerId))];
          const owners = await Promise.all(producers.map(ownerOf));
          await notify(owners, {
            type: "PAYMENT",
            title: "Nueva venta",
            body: `El pedido ${order} fue pagado. Recibirás tu liquidación al entregarse.`,
            link: "/pagos",
          });
          return notify([data.buyerId], {
            type: "PAYMENT",
            title: "Pago aprobado",
            body: `Recibimos el pago del pedido ${order}. Te avisaremos cuando salga a ruta.`,
            link: "/entregas",
          });
        }
        case "payment.declined":
          return notify([data.buyerId], { type: "PAYMENT", title: "Pago rechazado", body: data.reason, link: "/pedidos" });
        case "delivery.in_transit":
          return notify([data.buyerId], { type: "DELIVERY", title: "Pedido en camino", body: `El pedido ${order} salió a ruta.`, link: "/entregas" });
        case "delivery.completed":
          return notify([data.buyerId], {
            type: "DELIVERY",
            title: "Pedido entregado",
            body: `¡Que lo disfrutes! Pedido ${order}.`,
            link: "/pedidos",
          });
        case "delivery.failed":
          return notify([data.buyerId, ...(await admins())], {
            type: "DELIVERY",
            title: "Entrega fallida",
            body: `No fue posible entregar el pedido ${order}. Se programará un nuevo intento.`,
            link: "/entregas",
          });
        case "coldchain.breach":
          return notify(await admins(), {
            type: "DELIVERY",
            title: "⚠ Ruptura de cadena de frío",
            body: `El pedido ${order} registró ${data.celsius} °C (rango ${data.range?.min ?? 0}–${data.range?.max ?? 8} °C).`,
            link: "/entregas",
          });
        case "settlement.available":
          return notify([await ownerOf(data.producerId)], {
            type: "PAYMENT",
            title: "Liquidación disponible",
            body: `El pedido ${order} fue entregado. Tu pago está listo para transferirse.`,
            link: "/pagos",
          });
        case "settlement.paid":
          return notify([await ownerOf(data.producerId)], {
            type: "PAYMENT",
            title: "Te pagamos",
            body: `Transferimos ${cop(data.net)} del pedido ${order}.`,
            link: "/pagos",
          });
      }
    }),
  );
}
