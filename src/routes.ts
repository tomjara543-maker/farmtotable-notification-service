import { Router } from "express";
import { requireUser, userOf } from "./auth";
import { prisma } from "./db";
import { Notification } from "./generated/prisma/client";
import { notFound } from "./http";

const toJson = (n: Notification) => ({ ...n, link: n.link ?? undefined });

export function notificationRoutes() {
  const router = Router();
  router.use(requireUser());

  router.get("/mine", async (_req, res) => {
    const list = await prisma.notification.findMany({ where: { userId: userOf(res).id }, orderBy: { createdAt: "desc" }, take: 100 });
    res.json(list.map(toJson));
  });

  router.get("/unread-count", async (_req, res) => {
    res.json({ count: await prisma.notification.count({ where: { userId: userOf(res).id, read: false } }) });
  });

  router.post("/read-all", async (_req, res) => {
    await prisma.notification.updateMany({ where: { userId: userOf(res).id, read: false }, data: { read: true } });
    res.status(204).end();
  });

  router.post("/:id/read", async (req, res) => {
    const where = { id: String(req.params.id), userId: userOf(res).id };
    const { count } = await prisma.notification.updateMany({ where, data: { read: true } });
    if (!count) throw notFound("Notificación");
    res.json(toJson((await prisma.notification.findFirst({ where }))!));
  });

  return router;
}
